// Narrow interoperability layer between OpenAI Chat, Responses and Anthropic
// Messages for shim-owned providers. Reject unknown payload shapes explicitly.
const ERROR = "Unsupported request content for provider bridge";

function textParts(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError(ERROR);
  let result = "";
  for (const part of value) {
    if (part?.type === "text" || part?.type === "input_text" || part?.type === "output_text") {
      if (typeof part.text !== "string") throw new TypeError(ERROR);
      result += part.text;
    } else throw new TypeError(ERROR);
  }
  return result;
}

function fromAnthropic(body) {
  if (!Array.isArray(body.messages)) throw new TypeError(ERROR);
  const messages = [];
  if (body.system) messages.push({ role: "system", content: textParts(body.system) });
  for (const source of body.messages) {
    if (!["user", "assistant"].includes(source.role)) throw new TypeError(ERROR);
    if (typeof source.content === "string") {
      messages.push({ role: source.role, content: source.content });
      continue;
    }
    if (!Array.isArray(source.content)) throw new TypeError(ERROR);
    const text = [];
    const calls = [];
    for (const part of source.content) {
      if (part?.type === "text") text.push(textParts([part]));
      else if (part?.type === "thinking" && typeof part.thinking === "string") {
        // Historical thinking is account-local. Do not duplicate it as text.
        continue;
      } else if (part?.type === "tool_use" && typeof part.name === "string"
          && typeof part.id === "string") {
        calls.push({ id: part.id, type: "function", function: {
          name: part.name, arguments: JSON.stringify(part.input ?? {}),
        } });
      } else if (part?.type === "tool_result" && typeof part.tool_use_id === "string") {
        if (text.length) {
          messages.push({ role: source.role, content: text.join("") });
          text.length = 0;
        }
        messages.push({ role: "tool", tool_call_id: part.tool_use_id,
          content: textParts(part.content) });
      } else throw new TypeError(ERROR);
    }
    if (calls.length || text.length) {
      messages.push({ role: source.role, content: text.join("") || null,
        ...(calls.length ? { tool_calls: calls } : {}) });
    }
  }
  return { model: body.model, messages, stream: body.stream === true,
    max_tokens: body.max_tokens,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(Array.isArray(body.tools) ? { tools: body.tools.map(x => ({
      type: "function", function: { name: x.name, description: x.description,
        parameters: x.input_schema },
    })) } : {}),
  };
}

function fromResponses(body) {
  let input = body.input;
  if (typeof input === "string") input = [{ role: "user", content: input }];
  if (!Array.isArray(input)) throw new TypeError(ERROR);
  const messages = [];
  if (body.instructions) messages.push({ role: "system", content: textParts(body.instructions) });
  for (const part of input) {
    if (part?.type === "function_call" && typeof part.name === "string") {
      messages.push({ role: "assistant", content: null,
        tool_calls: [{ type: "function", id: part.call_id,
          function: { name: part.name, arguments: part.arguments } }] });
    } else if (part?.type === "function_call_output" && typeof part.call_id === "string") {
      messages.push({ role: "tool", tool_call_id: part.call_id,
        content: textParts(part.output) });
    } else if (["developer", "system", "user", "assistant"].includes(part?.role)) {
      messages.push({ role: part.role, content: textParts(part.content) });
    } else throw new TypeError(ERROR);
  }
  return { model: body.model, messages, stream: body.stream === true,
    max_tokens: body.max_output_tokens,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(Array.isArray(body.tools) ? { tools: body.tools.map(x => ({
      type: "function", function: { name: x.name,
        description: x.description, parameters: x.parameters },
    })) } : {}),
    ...(body.reasoning?.effort ? { reasoning_effort: body.reasoning.effort } : {}),
  };
}

export function requestAsChat(path, body) {
  if (!body || typeof body !== "object" || typeof body.model !== "string") {
    throw new TypeError(ERROR);
  }
  if (path === "/v1/chat/completions") return structuredClone(body);
  if (path === "/v1/messages") return fromAnthropic(body);
  if (path === "/v1/responses") return fromResponses(body);
  throw new TypeError(ERROR);
}

function chatResult(body) {
  return (body.choices ?? [{}])[0] ?? {};
}

function toAnthropic(body, model) {
  const choice=chatResult(body);
  const message=choice.message ?? {};
  const content=[];
  if (typeof message.reasoning_content === "string" && message.reasoning_content) {
    content.push({ type:"thinking", thinking:message.reasoning_content });
  }
  if (typeof message.content === "string" && message.content) {
    content.push({ type:"text", text:message.content });
  }
  for (const call of message.tool_calls ?? []) {
    let input;
    try { input=JSON.parse(call.function?.arguments ?? "{}"); } catch { input={}; }
    content.push({ type:"tool_use", id:call.id, name:call.function?.name, input });
  }
  return { id:body.id ?? "msg_shim", type:"message", role:"assistant",
    model, content, stop_reason: choice.finish_reason === "tool_calls" ? "tool_use"
      : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence:null,
    usage: { input_tokens:body.usage?.prompt_tokens ?? 0,
      output_tokens:body.usage?.completion_tokens ?? 0,
      ...(body.usage?.prompt_tokens_details?.cached_tokens !== undefined
        ? { cache_read_input_tokens:body.usage.prompt_tokens_details.cached_tokens } : {}),
    } };
}

function toResponses(body, model) {
  const choice=chatResult(body);
  const msg=choice.message ?? {};
  const output=[];
  if (typeof msg.content === "string" && msg.content) {
    output.push({ id:"msg_"+(body.id ?? "shim"), type:"message", status:"completed",
      role:"assistant",content:[{type:"output_text",text:msg.content,annotations:[]}] });
  }
  for (const call of msg.tool_calls ?? []) {
    output.push({ type:"function_call", name:call.function?.name,
      call_id:call.id, arguments:call.function?.arguments ?? "{}",
      status:"completed" });
  }
  const cached=body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return { id:body.id ?? "resp_shim",object:"response",created_at:body.created ?? Math.floor(Date.now()/1000),
    status:"completed", model, output,
    usage:{ input_tokens:body.usage?.prompt_tokens ?? 0,
      input_tokens_details:{cached_tokens:cached},
      output_tokens:body.usage?.completion_tokens ?? 0,
      total_tokens:body.usage?.total_tokens ?? 0 },
    error:null, incomplete_details:null };
}

export function convertChatJson(path, body, model) {
  if (path === "/v1/chat/completions") return body;
  if (path === "/v1/messages") return toAnthropic(body,model);
  if (path === "/v1/responses") return toResponses(body,model);
  throw new TypeError(ERROR);
}

const encoder=new TextEncoder();
const sse=(name,data)=>encoder.encode((name ? "event: "+name+"\n" : "")+
  "data: "+JSON.stringify(data)+"\n\n");

export function convertChatSse(path, response, publicModel) {
  if (path === "/v1/chat/completions") return response;
  if (!response.body) return response;
  const decoder=new TextDecoder();
  const id="shim_"+Date.now();
  let pending="";
  let started=false;
  let outputStarted=false;
  let output="";
  let usage={};
  let finalEmitted=false;
  const outputStream=new TransformStream({
    transform(bytes,controller) {
      pending+=decoder.decode(bytes,{stream:true});
      for (;;) {
        const match=/\r?\n\r?\n/.exec(pending);
        if (!match) break;
        const block=pending.slice(0,match.index);
        pending=pending.slice(match.index+match[0].length);
        const data=block.split(/\r?\n/).filter(x=>x.startsWith("data:"))
          .map(x=>x.slice(5).trim()).join("\n");
        if (!data || data==="[DONE]") continue;
        let event;
        try { event=JSON.parse(data); } catch { continue; }
        if (event.usage) usage=event.usage;
        // The Responses and Messages APIs have typed tool-call events.
        // Never silently discard streamed tool calls while adapting chat SSE.
        if ((event.choices ?? []).some(c => c.delta?.tool_calls?.length)) {
          controller.enqueue(sse("error", { type: "error",
            error: { type: "unsupported_tool_stream",
              message: "Use non-streaming mode for bridge tool calls" } }));
          finalEmitted=true;
          controller.terminate();
          return;
        }
        const text=(event.choices ?? []).map(c=>c.delta?.content ?? "").join("");
        const finished=(event.choices ?? []).some(c=>c.finish_reason);
        if (path==="/v1/messages") {
          if (!started) {
            controller.enqueue(sse("message_start",{type:"message_start",
              message:{id,type:"message",role:"assistant",model:publicModel,
                content:[],stop_reason:null,stop_sequence:null,
                usage:{input_tokens:0,output_tokens:0}}}));
            started=true;
          }
          if (text && !outputStarted) {
            controller.enqueue(sse("content_block_start",{type:"content_block_start",index:0,
              content_block:{type:"text",text:""}}));
            outputStarted=true;
          }
          if (text) {
            output+=text;
            controller.enqueue(sse("content_block_delta",{type:"content_block_delta",index:0,
              delta:{type:"text_delta",text}}));
          }
          if (finished && !finalEmitted) {
            if (outputStarted) controller.enqueue(sse("content_block_stop",
              {type:"content_block_stop",index:0}));
            controller.enqueue(sse("message_delta",{type:"message_delta",
              delta:{stop_reason:"end_turn",stop_sequence:null},
              usage:{output_tokens:usage.completion_tokens ?? 0}}));
            controller.enqueue(sse("message_stop",{type:"message_stop"}));
            finalEmitted=true;
          }
        } else {
          if (!started) {
            controller.enqueue(sse("response.created",{type:"response.created",
              response:{id,object:"response",model:publicModel,status:"in_progress",output:[]}}));
            started=true;
          }
          if (text && !outputStarted) {
            controller.enqueue(sse("response.output_item.added",
              {type:"response.output_item.added",output_index:0,
                item:{id:"msg_"+id,type:"message",role:"assistant",status:"in_progress",content:[]}}));
            controller.enqueue(sse("response.content_part.added",
              {type:"response.content_part.added",output_index:0,content_index:0,
                part:{type:"output_text",text:"",annotations:[]}}));
            outputStarted=true;
          }
          if (text) {
            output+=text;
            controller.enqueue(sse("response.output_text.delta",
              {type:"response.output_text.delta",output_index:0,content_index:0,delta:text}));
          }
          if (finished && !finalEmitted) {
            controller.enqueue(sse("response.output_text.done",
              {type:"response.output_text.done",output_index:0,content_index:0,text:output}));
            controller.enqueue(sse("response.completed",
              {type:"response.completed",response:{
                id,object:"response",model:publicModel,status:"completed",
                output:[{id:"msg_"+id,type:"message",role:"assistant",status:"completed",
                  content:[{type:"output_text",text:output,annotations:[]}]}],
                usage:{input_tokens:usage.prompt_tokens??0,
                  output_tokens:usage.completion_tokens??0,
                  total_tokens:usage.total_tokens??0,
                  input_tokens_details:{cached_tokens:usage.prompt_tokens_details?.cached_tokens??0}},
              }}));
            finalEmitted=true;
          }
        }
      }
    },
    flush(controller) {
      if (!started || finalEmitted) return;
      if (path === "/v1/messages") {
        if(outputStarted)controller.enqueue(sse("content_block_stop",{type:"content_block_stop",index:0}));
        controller.enqueue(sse("message_delta",{type:"message_delta",
          delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:usage.completion_tokens??0}}));
        controller.enqueue(sse("message_stop",{type:"message_stop"}));
      } else {
        controller.enqueue(sse("response.completed",{type:"response.completed",
          response:{id,model:publicModel,status:"completed",object:"response",
            output:[{type:"message",role:"assistant",content:[{type:"output_text",text:output}]}]}}));
      }
    },
  });
  return new Response(response.body.pipeThrough(outputStream),{
    status:response.status,headers:{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-store"}});
}

export async function convertChatResponse(path,response,model) {
  if (path==="/v1/chat/completions" || !response.ok) return response;
  if ((response.headers.get("content-type")??"").includes("text/event-stream")) {
    return convertChatSse(path,response,model);
  }
  const body=await response.json();
  return Response.json(convertChatJson(path,body,model),{status:response.status,
    headers:{"cache-control":"no-store"}});
}
