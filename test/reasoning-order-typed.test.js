import { describe, test, expect } from "bun:test";
import { orderTypedStream } from "../lib/reasoning-order-typed.js";

const sse=(type,data)=>"event: "+type+"\ndata: "+JSON.stringify({type,...data})+"\n\n";
const source=(text,split=4)=>new ReadableStream({
  start(c){const e=new TextEncoder();for(let i=0;i<text.length;i+=split)c.enqueue(e.encode(text.slice(i,i+split)));c.close();}
});
const parse=(s)=>s.split(/\r?\n\r?\n/).filter(Boolean).map(block=>{
  const data=block.split(/\r?\n/).filter(x=>x.startsWith("data:")).map(x=>x.slice(5).trimStart()).join("\n");
  return data?JSON.parse(data):{comment:block};
});
const run=async(s,protocol)=>parse(await new Response(orderTypedStream(source(s),protocol)).text());
describe("protocol-aware reasoning-first streamed output",()=>{
 test("Anthropic Messages keeps thinking/signature before all text and tool blocks, reindexing correctly",async()=>{
  const s=[
   sse("message_start",{message:{content:[],role:"assistant"}}),
   sse("content_block_start",{index:0,content_block:{type:"text",text:""}}),
   sse("content_block_delta",{index:0,delta:{type:"text_delta",text:"Hello "}}),
   sse("content_block_stop",{index:0}),
   sse("content_block_start",{index:1,content_block:{type:"thinking",thinking:""}}),
   sse("content_block_delta",{index:1,delta:{type:"thinking_delta",thinking:"Reason"}}),
   sse("content_block_delta",{index:1,delta:{type:"signature_delta",signature:"abc"}}),
   sse("content_block_stop",{index:1}),
   sse("content_block_start",{index:2,content_block:{type:"tool_use",id:"call_1",name:"exec",input:{}}}),
   sse("content_block_stop",{index:2}),
   sse("message_delta",{delta:{stop_reason:"tool_use"},usage:{output_tokens:5}}),
   sse("message_stop",{}),
  ].join("");
  const frames=await run(s,"messages");
  const reasonAt=frames.findIndex(x=>x.delta?.type==="thinking_delta");
  const bodyAt=frames.findIndex(x=>x.delta?.type==="text_delta");
  expect(reasonAt).toBeGreaterThan(0);
  expect(reasonAt).toBeLessThan(bodyAt);
  expect(frames.find(x=>x.delta?.type==="thinking_delta").index).toBe(0);
  expect(frames.find(x=>x.delta?.type==="signature_delta").index).toBe(0);
  expect(frames.find(x=>x.delta?.type==="text_delta").index).toBe(1);
  expect(frames.filter(x=>x.type==="content_block_start").map(x=>[x.index,x.content_block.type]))
    .toEqual([[0,"thinking"],[1,"text"],[2,"tool_use"]]);
  expect(frames.at(-2).delta.stop_reason).toBe("tool_use");
  expect(frames.at(-1).type).toBe("message_stop");
 });
 test("Responses reorders late reasoning item before message item and completed output array",async()=>{
  const output=[
    {type:"message",id:"m1",content:[{type:"output_text",text:"Body"}]},
    {type:"reasoning",id:"r1",summary:[{type:"summary_text",text:"Thought"}]},
  ];
  const s=[
   sse("response.created",{sequence_number:0,response:{id:"resp",output:[]}}),
   sse("response.output_item.added",{sequence_number:1,output_index:0,item:{type:"message",id:"m1"}}),
   sse("response.output_text.delta",{sequence_number:2,output_index:0,content_index:0,delta:"Body"}),
   sse("response.output_item.done",{sequence_number:3,output_index:0,item:output[0]}),
   sse("response.output_item.added",{sequence_number:4,output_index:1,item:{type:"reasoning",id:"r1"}}),
   sse("response.reasoning_summary_text.delta",{sequence_number:5,output_index:1,summary_index:0,delta:"Thought"}),
   sse("response.output_item.done",{sequence_number:6,output_index:1,item:output[1]}),
   sse("response.completed",{sequence_number:7,response:{id:"resp",output,usage:{input_tokens:7,output_tokens:6}}}),
  ].join("");
  const frames=await run(s,"responses");
  const reasoning=frames.find(x=>x.type==="response.reasoning_summary_text.delta");
  const text=frames.find(x=>x.type==="response.output_text.delta");
  expect(frames.indexOf(reasoning)).toBeLessThan(frames.indexOf(text));
  expect(reasoning.output_index).toBe(0);
  expect(text.output_index).toBe(1);
  expect(frames.filter(x=>x.type==="response.output_item.added").map(x=>x.item.type))
    .toEqual(["reasoning","message"]);
  expect(frames.at(-1).response.output.map(x=>x.type)).toEqual(["reasoning","message"]);
  expect(frames.at(-1).response.usage.output_tokens).toBe(6);
  expect(frames.map(x=>x.sequence_number)).toEqual([...Array(frames.length).keys()]);
 });
 test("Messages with normal text only retain all content and message_stop",async()=>{
  const frames=await run([
    sse("message_start",{message:{role:"assistant",content:[]}}),
    sse("content_block_start",{index:0,content_block:{type:"text",text:""}}),
    sse("content_block_delta",{index:0,delta:{type:"text_delta",text:"all body"}}),
    sse("content_block_stop",{index:0}),
    sse("message_stop",{}),
  ].join(""),"messages");
  expect(frames.map(f=>f.type)).toEqual([
    "message_start","content_block_start","content_block_delta","content_block_stop","message_stop"]);
  expect(frames[2].delta.text).toBe("all body");
 });
 test("preserves literal <think> in output_text and does not infer channel from prose",async()=>{
  const frames=await run([
    sse("response.created",{response:{id:"r",output:[]}}),
    sse("response.output_item.added",{output_index:0,item:{type:"message",id:"m"}}),
    sse("response.output_text.delta",{output_index:0,delta:"<think>quoted literal</think>"}),
    sse("response.completed",{response:{id:"r",output:[{type:"message",id:"m"}]}}),
  ].join(""),"responses");
  expect(frames.find(x=>x.type==="response.output_text.delta").delta).toBe("<think>quoted literal</think>");
 });
 test("Responses preserves tool argument deltas and a late reasoning summary",async()=>{
  const s=[
    sse("response.created",{response:{id:"r2",output:[]}}),
    sse("response.output_item.added",{output_index:0,item:{type:"function_call",id:"fn",name:"run"}}),
    sse("response.function_call_arguments.delta",{output_index:0,delta:'{"x":'}),
    sse("response.function_call_arguments.delta",{output_index:0,delta:"1}"}),
    sse("response.output_item.done",{output_index:0,item:{type:"function_call",id:"fn",name:"run",arguments:'{"x":1}'}}),
    sse("response.content_part.added",{output_index:1,part:{type:"reasoning_summary_text",text:""}}),
    sse("response.reasoning_summary_text.delta",{output_index:1,delta:"Reason"}),
    sse("response.completed",{response:{output:[
      {type:"function_call",id:"fn"},{type:"reasoning",id:"thinking"}]}}),
  ].join("");
  const frames=await run(s,"responses");
  const reasoning=frames.findIndex(x=>x.type==="response.reasoning_summary_text.delta");
  const tool=frames.findIndex(x=>x.type==="response.function_call_arguments.delta");
  expect(reasoning).toBeLessThan(tool);
  expect(frames.filter(x=>x.type==="response.function_call_arguments.delta").map(x=>x.delta).join("")).toBe('{"x":1}');
  expect(frames.at(-1).response.output.map(x=>x.type)).toEqual(["reasoning","function_call"]);
 });
 test("Messages preserves strict index mapping even when thinking starts after body",async()=>{
  const frames=await run([
    sse("message_start",{message:{content:[]}}),
    sse("content_block_start",{index:4,content_block:{type:"text",text:""}}),
    sse("content_block_delta",{index:4,delta:{type:"text_delta",text:"Body"}}),
    sse("content_block_start",{index:10,content_block:{type:"thinking",thinking:""}}),
    sse("content_block_delta",{index:10,delta:{type:"thinking_delta",thinking:"Think"}}),
    sse("content_block_stop",{index:10}),
    sse("content_block_stop",{index:4}),
    sse("message_stop",{}),
  ].join(""),"messages");
  expect(frames.filter(x=>x.type==="content_block_start").map(x=>x.index)).toEqual([0,1]);
  expect(frames.find(x=>x.delta?.type==="thinking_delta").index).toBe(0);
  expect(frames.find(x=>x.delta?.type==="text_delta").index).toBe(1);
  expect(frames.at(-1).type).toBe("message_stop");
 });
 test("a bare [DONE] must not escape ahead of buffered body",async()=>{
  const wire = [
    sse("message_start",{message:{role:"assistant",content:[]}}),
    sse("content_block_start",{index:0,content_block:{type:"text",text:""}}),
    sse("content_block_delta",{index:0,delta:{type:"text_delta",text:"Body"}}),
    "data: [DONE]\n\n",
  ].join("");
  const output = await new Response(orderTypedStream(source(wire),"messages")).text();
  expect(output.indexOf("Body")).toBeLessThan(output.indexOf("[DONE]"));
 });
 test("invalid target protocol is rejected",()=>{
  expect(()=>orderTypedStream(source(""),"unknown")).toThrow("Unsupported");
 });
});
