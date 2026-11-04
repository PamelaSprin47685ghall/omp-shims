import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withCustomProviderFallback } from "../lib/lazy-router/custom-provider-fallback.js";
import { chatAsResponses, responsesAsChat, responsesSseAsChat } from "../lib/lazy-router/responses-wire.js";

const REF="openai-api/gpt-6.1-terra";
function setup() {
  const dir=mkdtempSync(join(tmpdir(),"custom-bridge-"));
  const tokenPath=join(dir,"gateway-token");
  writeFileSync(tokenPath,"admin-token",{mode:0o600});
  const provider={
    name:"openai-api",model:{id:"gpt-6.1-terra"},
    config:{api:"openai-responses",apiKey:"fake-nonsecret-key",models:[]},
    base:new URL("https://api.example.invalid/v1"),
  };
  const configured=new Map([[REF,provider]]);
  const request=(path,auth,body)=>new Request("http://127.0.0.1"+path,{
    method:"POST",headers:{"authorization":"Bearer "+auth},
    body:JSON.stringify({model:REF,...body}),
  });
  return {dir,tokenPath,configured,request};
}
describe("stock OMP custom provider compatibility",()=>{
  test("does not bypass Gateway authorization",async()=>{
    const x=setup();let outbound=0;let gateway=0;
    try {
      const handler=withCustomProviderFallback(
        ()=>{gateway++;return Response.json({native:true},{status:401});},
        {tokenPath:x.tokenPath,configured:x.configured,
          fetchImpl:async()=>{outbound++;return Response.json({});}});
      const response=await handler(x.request("/v1/chat/completions",
        "wrong",{messages:[{role:"user",content:"OK"}]}));
      expect(response.status).toBe(401);
      expect(gateway).toBe(1);
      expect(outbound).toBe(0);
    }finally{rmSync(x.dir,{recursive:true,force:true});}
  });
  test("preserves native model ownership and never double-proxies",async()=>{
    const x=setup();
    try{
      const handler=withCustomProviderFallback(()=>Response.json({native:true}),
        {tokenPath:x.tokenPath,configured:x.configured,nativeRegistered:ref=>ref===REF,
         fetchImpl:async()=>{throw new Error("should not contact upstream");}});
      const response=await handler(x.request("/v1/chat/completions","admin-token",
        {messages:[{role:"user",content:"OK"}]}));
      expect(await response.json()).toEqual({native:true});
    }finally{rmSync(x.dir,{recursive:true,force:true});}
  });
  test("Chat to Flex Responses maps model, service tier and cached output correctly",async()=>{
    const x=setup();
    let upstream;
    try {
      const handler=withCustomProviderFallback(()=>Response.json({native:true}),
        {tokenPath:x.tokenPath,configured:x.configured,
          fetchImpl:async(url,opts)=>{
            upstream={url,headers:opts.headers,body:JSON.parse(opts.body)};
            return Response.json({id:"resp_1",object:"response",
              output:[{type:"message",role:"assistant",
                content:[{type:"output_text",text:"OK"}]}],
              usage:{input_tokens:100,output_tokens:2,total_tokens:102,
                input_tokens_details:{cached_tokens:90}}});
          }});
      const response=await handler(x.request("/v1/chat/completions","admin-token",
        {messages:[{role:"user",content:"OK"}],max_tokens:32}));
      const data=await response.json();
      expect(response.status).toBe(200);
      expect(data.choices[0].message.content).toBe("OK");
      expect(data.usage.prompt_tokens_details.cached_tokens).toBe(90);
      expect(upstream.url).toBe("https://api.example.invalid/v1/responses");
      expect(upstream.body.model).toBe("gpt-6.1-terra");
      expect(upstream.body.service_tier).toBe("flex");
      expect(upstream.body.store).toBe(false);
      expect(upstream.headers.authorization).toBe("Bearer fake-nonsecret-key");
    }finally{rmSync(x.dir,{recursive:true,force:true});}
  });
  test("Responses stream emits live Chat deltas and final real token usage",async()=>{
    const source=new Response(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"O"}\n\n'
      +'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"K"}\n\n'
      +'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":2,"total_tokens":102,"input_tokens_details":{"cached_tokens":90}}}}\n\n',
      {headers:{"content-type":"text/event-stream"}});
    const res=responsesSseAsChat(source,REF);
    const data=await res.text();
    expect(data).toContain('"content":"O"');
    expect(data).toContain('"content":"K"');
    expect(data).toContain('"cached_tokens":90');
    expect(data).toContain('data: [DONE]');
  });
  test("Chat-to-Responses preserves function calls and uses explicit flex",()=>{
    const result=chatAsResponses({messages:[{role:"assistant",content:null,
      tool_calls:[{id:"c1",function:{name:"calc",arguments:"{}"}}]}],
      max_completion_tokens:33}, "gpt-6.1-terra",{flex:true});
    expect(result.input[0].type).toBe("function_call");
    expect(result.max_output_tokens).toBe(33);
    expect(result.service_tier).toBe("flex");
    expect(result.store).toBe(false);
    const r=responsesAsChat({output:[{type:"function_call",call_id:"c1",
      name:"calc",arguments:"{}"}]},REF);
    expect(r.choices[0].finish_reason).toBe("tool_calls");
  });
});
