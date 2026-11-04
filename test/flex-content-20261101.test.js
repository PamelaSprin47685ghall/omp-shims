import { test,expect } from "bun:test";
import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chatAsResponses } from "../lib/lazy-router/responses-wire.js";
import { withCustomProviderFallback } from "../lib/lazy-router/custom-provider-fallback.js";
import { classifyFailure,FAILURE } from "../lib/lazy-router/failures.js";

const REF="openai-api/gpt-6.1-terra";
const provider={
  name:"openai-api",model:{id:"gpt-6.1-terra"},
  config:{api:"openai-responses",apiKey:"synthetic-test-key"},
  base:new URL("https://api.example.invalid/v1"),
};

test("Flex preserves text content blocks across multi-turn Chat history",()=>{
  const original={messages:[
    {role:"system",content:[{type:"text",text:"Answer precisely."}]},
    {role:"user",content:[{type:"text",text:"Alpha "},{type:"text",text:"beta"}]},
    {role:"assistant",content:[{type:"output_text",text:"Understood."}]},
    {role:"user",content:[{type:"input_text",text:"Reply OK."}]},
  ],max_tokens:64,stream:false};
  const result=chatAsResponses(original,"gpt-6.1-terra",{flex:true});
  expect(result.model).toBe("gpt-6.1-terra");
  expect(result.service_tier).toBe("flex");
  expect(result.store).toBe(false);
  expect(result.input[1].content).toEqual([
    {type:"input_text",text:"Alpha "},{type:"input_text",text:"beta"},
  ]);
  expect(result.input[2].content).toEqual([
    {type:"output_text",text:"Understood."},
  ]);
});

test("Flex preserves user image URL and valid tool call history",()=>{
  const converted=chatAsResponses({messages:[
    {role:"user",content:[{type:"text",text:"Inspect image."},
      {type:"image_url",image_url:{url:"https://example.invalid/p.png",detail:"low"}}]},
    {role:"assistant",content:null,tool_calls:[{
      type:"function",id:"call1",function:{name:"calc",arguments:'{"x":1}'}}]},
    {role:"tool",tool_call_id:"call1",
      content:[{type:"text",text:"answer "},{type:"text",text:"4"}]},
  ],max_tokens:64},"gpt-6.1-terra");
  expect(converted.input[0].content[1]).toEqual({
    type:"input_image",image_url:"https://example.invalid/p.png",detail:"low",
  });
  expect(converted.input[1]).toEqual({
    type:"function_call",call_id:"call1",name:"calc",arguments:'{"x":1}',
  });
  expect(converted.input[2]).toEqual({
    type:"function_call_output",call_id:"call1",output:"answer 4",
  });
});

test("Flex refuses unknown multimodal formats and missing content without dropping anything",()=>{
  for(const content of [
    [{type:"audio",audio:"bytes"}],
    [{type:"file",file_id:"file-1"}],
    [{type:"image_url",image_url:{}}],
    [],
  ]){
    expect(()=>chatAsResponses({messages:[{role:"user",content}]},
      "gpt-6.1-terra")).toThrow(/adapter_unsupported/);
  }
  expect(()=>chatAsResponses({messages:[{role:"assistant",content:null}]},
    "gpt-6.1-terra")).toThrow(/adapter_unsupported/);
});

test("unsupported Flex request becomes one adapter failure, no upstream call or unit probe",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"flex-content-test-"));
  try{
    const tokenPath=join(dir,"gateway");
    writeFileSync(tokenPath,"synthetic-admin",{mode:0o600});
    let outbound=0;
    const fallback=withCustomProviderFallback(
      ()=>Response.json({native:true},{status:404}),{
        tokenPath,configured:new Map([[REF,provider]]),
        fetchImpl:async()=>{outbound++;return Response.json({});},
      });
    const request=new Request("http://localhost/v1/chat/completions",{
      method:"POST",
      headers:{authorization:"Bearer synthetic-admin"},
      body:JSON.stringify({model:REF,messages:[{role:"user",
        content:[{type:"audio",data:"unsupported"}]}]}),
    });
    const response=await fallback(request);
    expect(response.status).toBe(502);
    const body=await response.json();
    expect(body.error.type).toBe("adapter_unsupported");
    expect(outbound).toBe(0);
    const verdict={status:response.status,source:"upstream",
      message:JSON.stringify(body)};
    expect(classifyFailure({verdict,upstreamContacted:false})).toBe(FAILURE.ADAPTER);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("Flex sends multi-turn Chat typed blocks to official Responses upstream",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"flex-content-test-"));
  try{
    const tokenPath=join(dir,"gateway");
    writeFileSync(tokenPath,"synthetic-admin",{mode:0o600});
    let outgoing;
    const fallback=withCustomProviderFallback(
      ()=>Response.json({native:true},{status:404}),{
        tokenPath,configured:new Map([[REF,provider]]),
        fetchImpl:async(url,options)=>{
          outgoing={url,headers:options.headers,payload:JSON.parse(options.body)};
          return Response.json({id:"resp_test",
            output:[{type:"message",role:"assistant",
              content:[{type:"output_text",text:"OK"}]}],
            usage:{input_tokens:120,output_tokens:2,
              input_tokens_details:{cached_tokens:100}}});
        },
      });
    const req=new Request("http://localhost/v1/chat/completions",{
      method:"POST",headers:{authorization:"Bearer synthetic-admin"},
      body:JSON.stringify({model:REF,messages:[
        {role:"user",content:[{type:"text",text:"Hello "},{type:"text",text:"world"}]},
        {role:"assistant",content:"Understood."},
        {role:"user",content:[{type:"input_text",text:"Reply OK"}]},
      ],max_tokens:32}),
    });
    const response=await fallback(req);
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result.choices[0].message.content).toBe("OK");
    expect(result.usage.prompt_tokens_details.cached_tokens).toBe(100);
    expect(outgoing.payload.input[0].content[1].text).toBe("world");
    expect(outgoing.payload.service_tier).toBe("flex");
    expect(outgoing.payload.store).toBe(false);
    expect(outgoing.headers.authorization).toBe("Bearer synthetic-test-key");
  }finally{rmSync(dir,{recursive:true,force:true});}
});
