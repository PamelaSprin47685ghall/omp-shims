import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPinned } from "../lib/credential-pin.js";
import { Attempt } from "../lib/lazy-router/attempt.js";
import { publishExtensionProvider, extensionTraits } from "../lib/lazy-router/extension-providers.js";
import { withExtensionFallback } from "../lib/lazy-router/extension-fallback.js";
import { lazyRouterHandler } from "../features/lazy-router.js";
import { allowedClientModel, disallowedClientModelRequest, lazyOnlyModelCatalog } from
  "../lib/lazy-router/client-model-policy.js";

const COMMAND = "commandcode/deepseek/deepseek-v4.1-flash";
const ROUTES = new Set(["lazy/pro","lazy/default","lazy/weak","lazy/task"]);

describe("Gateway clients can select only registered lazy/* routes", () => {
  const router = { handles: (model) => ROUTES.has(model) };
  test("exact Lazy routes work through each supported inference dialect", () => {
    for (const name of ROUTES)
      for (const path of ["/v1/chat/completions","/v1/responses","/v1/messages"])
        expect(disallowedClientModelRequest({method:"POST",pathname:path,
          body:{model:name},router,supportedFormat:true})).toBe(false);
    expect(allowedClientModel(COMMAND,router)).toBe(false);
  });
  test("direct, malformed, unsupported and unknown model writes are denied", () => {
    for (const model of [COMMAND,"kiro/claude-opus-5-5","lazy/unknown","lazy/task/evil",undefined])
      expect(disallowedClientModelRequest({method:"POST",pathname:"/v1/chat/completions",
        body:{model},router,supportedFormat:true})).toBe(true);
    expect(disallowedClientModelRequest({method:"POST",pathname:"/v1/systemone",
      body:{model:"lazy/task"},router,supportedFormat:false})).toBe(true);
  });
  test("edge rejection never invokes the inner Gateway, but lazy routes do", async () => {
    let native=0,lazy=0;
    const handle=lazyRouterHandler(async request=>{
      native++;
      if (new URL(request.url).pathname==="/v1/models")
        return Response.json({object:"list",data:[{id:COMMAND}]});
      return Response.json({native:true},{status:200});
    },{router:{...router,
        advertisedModels:()=>[...ROUTES].map(id=>({id,object:"model"})),
        serve:async()=>{lazy++;return Response.json({routed:true});}},
      dispatcher:{bind(){}},statusPath:"/v1/lazy/status",statusPage:()=>null});
    const send=(model,path="/v1/chat/completions")=>handle(new Request("http://gateway"+path,{
      method:"POST",body:JSON.stringify({model,messages:[{role:"user",content:"OK"}]}),
    }));
    expect((await send(COMMAND)).status).toBe(403);
    expect((await send("kiro/claude-opus-5-5","/v1/messages")).status).toBe(403);
    expect(native).toBe(0);
    expect((await send("lazy/task")).status).toBe(200);
    expect(lazy).toBe(1);
    const resp=await handle(new Request("http://gateway/v1/models"));
    expect((await resp.json()).data.map(m=>m.id)).toEqual([...ROUTES]);
  });
  test("catalog forwards authentication errors without exposing provider IDs",async()=>{
    const denied=await lazyOnlyModelCatalog(Response.json({error:"bad"},{status:401}),[]);
    expect(denied.status).toBe(401);
  });
});

describe("pinned Command Code calls the installed plugin instead of OMP built-in",()=>{
  test("database credentials only; unpinned or wrong admin token never enters plugin",async()=>{
    const dir=mkdtempSync(join(tmpdir(),"cc-plugin-lazy-"));
    try{
      const tokenPath=join(dir,"token");
      writeFileSync(tokenPath,"test-admin-token",{mode:0o600});
      let hits=0;
      publishExtensionProvider("commandcode",{
        api:"commandcode-custom",
        models:[{id:"deepseek/deepseek-v4.1-flash",contextWindow:1000000,
          maxTokens:65536,reasoning:true,input:["text"],
          thinking:{efforts:["off","low","high","max"]}}],
        streamSimple(model,context,options){
          hits++;
          expect(model.id).toBe("deepseek/deepseek-v4.1-flash");
          expect(context.systemPrompt).toEqual([]);
          expect(options.apiKey).toBe("synthetic-db-token");
          expect(options.reasoning).toBe("max");
          return (async function*(){
            yield {type:"text_delta",delta:"OK"};
            yield {type:"done",reason:"stop",
              message:{usage:{input:10,output:2,cacheRead:9}}};
          })();
        },
      });
      expect(extensionTraits(COMMAND)?.contextWindow).toBe(1000000);
      const gateway=withExtensionFallback(()=>Response.json({error:"stock builtin rejected"},{status:403}),{
        tokenPath, nativeRegistered:()=>true,
        credentials:{list:()=>[{id:44,provider:"commandcode"}],
          resolve:async id=>id===44?{id,provider:"commandcode",secret:"synthetic-db-token"}:undefined},
      });
      const request=(key="test-admin-token")=>new Request("http://gateway/v1/chat/completions",{
        method:"POST",headers:{authorization:"Bearer "+key},
        body:JSON.stringify({model:COMMAND,
          messages:[{role:"user",content:"OK"}],max_tokens:16,reasoning_effort:"max"}),
      });
      expect((await gateway(request())).status).toBe(403); // not pinned
      expect(hits).toBe(0);
      // The public Gateway allowed the Lazy request before pinning it.
      // Its scoped bearer must not prevent a trusted pinned internal attempt.
      // Real stock OMP Command Code units have no credentialId. Require the
      // Router's Attempt scope and resolve the active account from its DB.
      const pending=new Attempt({
        unit:{provider:"commandcode",label:"commandcode"},
        model:COMMAND,
      });
      const scoped=await runPinned(pending,
        ()=>gateway(request("scoped-client-token")));
      expect(scoped.status).toBe(200);
      expect((await scoped.json()).choices[0].message.content).toBe("OK");
      // An arbitrary object resembling a pin is not a trusted Attempt.
      const forged=await runPinned({provider:"commandcode",credentialId:44},
        ()=>gateway(request()));
      expect(forged.status).toBe(403);
      const ok=await runPinned(new Attempt({
        unit:{provider:"commandcode",credentialId:44,label:"commandcode"},
        model:COMMAND,
      }),()=>gateway(request()));
      expect(ok.status).toBe(200);
      const data=await ok.json();
      expect(data.usage.prompt_tokens_details.cached_tokens).toBe(9);
      expect(hits).toBe(2);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
