import { test, expect } from "bun:test";
import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Attempt,createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { runPinned } from "../lib/credential-pin.js";
import { publishExtensionProvider } from "../lib/lazy-router/extension-providers.js";
import { withExtensionFallback } from "../lib/lazy-router/extension-fallback.js";

const API="https://api.commandcode.ai/provider/v1/responses";
const GEN="https://api.commandcode.ai/alpha/generate";
const MODEL="commandcode/deepseek/deepseek-v4.1-flash";
const credentials={isBrokerUrl:()=>false,resolve:async()=>undefined};

test("Command Code upgrade_required is a handshake, not failed attempt",async()=>{
 const attempt=new Attempt({unit:{provider:"commandcode",label:"commandcode"},model:MODEL});
 const layer=createAttemptLayer({credentials});
 await runPinned(attempt,async()=>{
  const upgraded=await layer(API,{method:"POST"},
    async()=>Response.json({error:{code:"upgrade_required",type:"permission_error"}},
      {status:403}));
  expect(upgraded.status).toBe(403);
  expect(attempt.result).toBeUndefined();
  const generated=await layer(GEN,{method:"POST"},
    async()=>Response.json({choices:[{message:{content:"OK"}}]},{status:200}));
  expect(generated.status).toBe(200);
  expect(attempt.result?.ok).toBe(true);
 });
});

test("unrelated Command Code 403 remains a genuine terminal failure",async()=>{
 const attempt=new Attempt({unit:{provider:"commandcode",label:"commandcode"},model:MODEL});
 const layer=createAttemptLayer({credentials});
 await runPinned(attempt,async()=>{
  await layer(API,{method:"POST"},async()=>Response.json(
    {error:{code:"permission_denied"}},{status:403}));
 });
 expect(attempt.result?.status).toBe(403);
 expect(attempt.result?.ok).toBe(false);
});

test("other providers cannot use Command Code upgrade handshake bypass",async()=>{
 const attempt=new Attempt({unit:{provider:"kiro",label:"kiro"},model:"kiro/x"});
 const layer=createAttemptLayer({credentials});
 await runPinned(attempt,async()=>await layer(API,{method:"POST"},
   async()=>Response.json({error:{code:"upgrade_required"}},{status:403})));
 expect(attempt.result?.ok).toBe(false);
});

test("plugin accepts text content arrays and rejects images as fallback candidate",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"cc-upgrade-content-"));
 const tokenPath=join(dir,"token");
 writeFileSync(tokenPath,"test-admin",{mode:0o600});
 let count=0;
 try {
  publishExtensionProvider("commandcode",{
    models:[{id:"deepseek/deepseek-v4.1-flash",contextWindow:1000000,maxTokens:65536}],
    streamSimple(m,context) {
      count++;
      expect(context.messages[0].content[0].text).toBe("Hello world");
      return (async function*(){yield {type:"text_delta",delta:"OK"};yield {type:"done",reason:"stop"};})();
    },
  });
  const fallback=withExtensionFallback(()=>Response.json({native:true},{status:403}),{
    tokenPath,nativeRegistered:()=>true,
    credentials:{list:()=>[{id:44,provider:"commandcode"}],resolve:async()=>({provider:"commandcode",secret:"synthetic-key"})},
  });
  async function run(content) {
    const attempt=new Attempt({unit:{provider:"commandcode",label:"commandcode"},model:MODEL});
    const req=new Request("http://127.0.0.1/v1/chat/completions",{method:"POST",
      headers:{authorization:"Bearer scoped-test"},
      body:JSON.stringify({model:MODEL,messages:[{role:"user",content}],max_tokens:16})});
    return await runPinned(attempt,()=>fallback(req));
  }
  const ok=await run([{type:"text",text:"Hello "},{type:"text",text:"world"}]);
  expect(ok.status).toBe(200);
  expect((await ok.json()).choices[0].message.content).toBe("OK");
  const invalid=await run([{type:"image_url",image_url:{url:"data:test"}}]);
  expect(invalid.status).toBe(502);
  expect((await invalid.json()).error.type).toBe("adapter_unsupported");
  expect(count).toBe(1);
 } finally{rmSync(dir,{recursive:true,force:true});}
});
