import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publishExtensionProvider } from "../lib/lazy-router/extension-providers.js";
import { withExtensionFallback } from "../lib/lazy-router/extension-fallback.js";

test("Kiro real plugin transport receives array systemPrompt and reasoning option", async () => {
  const dir=mkdtempSync(join(tmpdir(),"kiro-plugin-shim-"));
  try{
    const tokenPath=join(dir,"token");
    writeFileSync(tokenPath,"test-admin-token",{mode:0o600});
    let checked=false;
    publishExtensionProvider("kiro",{
      models:[{id:"claude-opus-5-5",contextWindow:1000000,maxTokens:128000,
        api:"kiro-api",input:["text"],reasoning:true}],
      streamSimple(model,context,options) {
        expect(model.id).toBe("claude-opus-5-5");
        expect(context.systemPrompt).toEqual(["Respect requirements."]);
        expect(context.messages[0].role).toBe("user");
        expect(options.reasoning).toBe("high");
        expect(options.apiKey).toBe("fake-test-kiro-token");
        checked=true;
        return (async function*() {
          yield {type:"text_delta",delta:"OK"};
          yield {type:"done",reason:"stop",message:{usage:{input:2,output:2}}};
        })();
      },
    });
    const handler=withExtensionFallback(()=>Response.json({native:true},{status:404}),{
      tokenPath,
      credentials:{list:()=>[{id:5,provider:"kiro"}],
        resolve:async()=>({id:5,provider:"kiro",secret:"fake-test-kiro-token"})},
    });
    const request=new Request("http://127.0.0.1:4000/v1/chat/completions",{
      method:"POST",headers:{authorization:"Bearer test-admin-token"},
      body:JSON.stringify({model:"kiro/claude-opus-5-5",
        messages:[{role:"system",content:"Respect requirements."},
          {role:"user",content:"Reply OK."}],
        reasoning_effort:"high",max_tokens:16}),
    });
    const response=await handler(request);
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("OK");
    expect(checked).toBe(true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
