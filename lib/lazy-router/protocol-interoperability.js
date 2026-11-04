// Narrow interoperability layer between OpenAI Chat, Responses and Anthropic
// Messages for shim-owned providers. Reject unknown payload shapes explicitly.
const ERROR = "Unsupported request content for provider bridge";

function textParts(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError(ERROR);
  let result = "";
  for (const part of value) {
    if (["text", "input_text", "output_text", "summary_text", "reasoning_text"].includes(part?.type)) {
      if (typeof part.text !== "string") throw new TypeError(ERROR);
      result += part.text;
    } else if (part?.type === "refusal" && typeof part.refusal === "string") {
      result += part.refusal;
    } else if (["input_image", "input_file", "image_url"].includes(part?.type)) {
      result += "[image]";
    } else throw new TypeError(ERROR);
  }
  return result;
}

const UNAVAILABLE_REASONING = "reasoning unavailable";

function reasoningText(item) {
  const parts = [];
  for (const part of [...(item?.summary ?? []), ...(item?.content ?? [])]) {
    if (typeof part?.text === "string" && part.text && part.text !== UNAVAILABLE_REASONING) parts.push(part.text);
  }
  return parts.join("\n");
}

/** Same opaque token the chat path stores as thinking.signature. */
function reasoningSignature(item) {
  if (typeof item?.encrypted_content === "string" && item.encrypted_content) return item.encrypted_content;
  if (typeof item?.signature === "string" && item.signature) return item.signature;
  return undefined;
}

function thinkingBlock(text, signature) {
  return {
    type: "thinking",
    thinking: [{ type: "text", text }],
    ...(signature ? { signature } : {}),
  };
}

function imagePart(part) {
  const raw = part.type === "image_url" ? part.image_url : part.image_url ?? part;
  const url = typeof raw === "string" ? raw : raw?.url;
  if (typeof url !== "string" || !url) throw new TypeError(ERROR);
  const detail = typeof raw === "object" ? raw.detail : part.detail;
  return { type: "image_url", image_url: { url, ...(detail ? { detail } : {}) } };
}

/** Chat content: a string when it is only text, otherwise text plus image_url blocks. */
function chatContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError(ERROR);
  const parts = [];
  let text = "";
  const flush = () => {
    if (!text) return;
    parts.push({ type: "text", text });
    text = "";
  };
  for (const part of value) {
    if (typeof part === "string") { text += part; continue; }
    if (["text", "input_text", "output_text", "summary_text", "reasoning_text"].includes(part?.type)) {
      if (typeof part.text !== "string") throw new TypeError(ERROR);
      text += part.text;
    } else if (part?.type === "refusal" && typeof part.refusal === "string") {
      text += part.refusal;
    } else if (part?.type === "input_image" || part?.type === "image_url") {
      flush();
      parts.push(imagePart(part));
    } else throw new TypeError(ERROR);
  }
  flush();
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.length ? parts : "";
}

/** Assistant history in the shape withMistralThinkingHistory writes. */
function assistantTurn({ text = "", thought = "", signature, calls }) {
  const content = [];
  if (thought) content.push(thinkingBlock(thought, signature));
  if (typeof text === "string") {
    if (text) content.push({ type: "text", text });
  } else if (Array.isArray(text)) {
    content.push(...text);
  }
  const message = { role: "assistant" };
  if (!content.length) message.content = null;
  else if (content.length === 1 && content[0].type === "text") message.content = content[0].text;
  else message.content = content;
  if (calls?.length) message.tool_calls = calls;
  return message;
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
  let pendingThought = "";
  let pendingSignature;
  if (body.instructions) messages.push({ role: "system", content: textParts(body.instructions) });
  const takeThought = () => {
    const thought = pendingThought;
    const signature = pendingSignature;
    pendingThought = "";
    pendingSignature = undefined;
    return { thought, signature };
  };
  for (const part of input) {
    if (part?.type === "reasoning") {
      const thought = reasoningText(part);
      const signature = reasoningSignature(part);
      if (thought) pendingThought = pendingThought ? `${pendingThought}\n${thought}` : thought;
      if (signature) pendingSignature = signature;
      continue;
    }
    if ((part?.type === "function_call" || part?.type === "custom_tool_call")
      && typeof part.name === "string") {
      const argumentsText = part.type === "custom_tool_call"
        ? (part.input ?? "{}")
        : (part.arguments ?? "{}");
      const thought = takeThought();
      messages.push(assistantTurn({
        thought: thought.thought,
        signature: thought.signature,
        calls: [{ type: "function", id: part.call_id,
          function: { name: part.name, arguments: argumentsText } }],
      }));
    } else if (part?.type === "function_call_output" && typeof part.call_id === "string") {
      messages.push({ role: "tool", tool_call_id: part.call_id,
        content: textParts(part.output) });
    } else if (part?.type === "custom_tool_call_output" && typeof part.call_id === "string") {
      messages.push({ role: "tool", tool_call_id: part.call_id,
        content: textParts(part.output) });
    } else if (part?.role === "assistant") {
      const thought = takeThought();
      messages.push(assistantTurn({
        text: chatContent(part.content),
        thought: thought.thought,
        signature: thought.signature,
      }));
    } else if (["developer", "system", "user"].includes(part?.role)) {
      messages.push({
        role: part.role === "developer" ? "system" : part.role,
        content: chatContent(part.content),
      });
    } else throw new TypeError(ERROR);
  }
  if (pendingThought || pendingSignature) {
    messages.push(assistantTurn({ thought: pendingThought, signature: pendingSignature }));
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
  const thought = typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
  const signature = typeof msg.reasoning_signature === "string" ? msg.reasoning_signature : undefined;
  if (thought || signature) {
    output.push({
      type: "reasoning",
      ...(signature ? { id: signature, encrypted_content: signature } : {}),
      summary: [],
      content: thought ? [{ type: "reasoning_text", text: thought }] : [],
    });
  }
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
  let thoughtText="";
  let thoughtSignature;
  let nextIndex=0;
  const toolStates=new Map();
  let textIndex=0;
  const reasoningOutput = () => thoughtText || thoughtSignature ? [{
    type: "reasoning",
    ...(thoughtSignature ? { id: thoughtSignature, encrypted_content: thoughtSignature } : {}),
    summary: [],
    content: thoughtText ? [{ type: "reasoning_text", text: thoughtText }] : [],
  }] : [];
  const toolOutputs = () => [...toolStates.values()].map((tool) => ({
    type: "function_call",
    id: tool.itemId,
    call_id: tool.callId,
    name: tool.name,
    arguments: tool.arguments,
    status: "completed",
  }));
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
        const text=(event.choices ?? []).map(c=>c.delta?.content ?? "").join("");
        const thought=(event.choices ?? []).map((choice) =>
          typeof choice.delta?.reasoning_content === "string" ? choice.delta.reasoning_content : "").join("");
        const signature=(event.choices ?? []).map((choice) => choice.delta?.reasoning_signature)
          .find((value) => typeof value === "string" && value);
        const calls=(event.choices ?? []).flatMap((choice) => choice.delta?.tool_calls ?? []);
        if (thought) thoughtText += thought;
        if (signature) thoughtSignature = signature;
        const finished=(event.choices ?? []).some(c=>c.finish_reason);
        const emitTool = (call) => {
          const key = call.index ?? call.id ?? toolStates.size;
          let tool = toolStates.get(key);
          if (!tool) {
            const outputIndex = nextIndex++;
            tool = {
              outputIndex,
              itemId: `fc_${id}_${outputIndex}`,
              callId: call.id || `call_${id}_${outputIndex}`,
              name: call.function?.name || "",
              arguments: "",
              opened: false,
            };
            toolStates.set(key, tool);
          }
          if (call.id) tool.callId = call.id;
          if (call.function?.name) tool.name = call.function.name;
          if (!started) {
            if (path === "/v1/messages") {
              controller.enqueue(sse("message_start",{type:"message_start",
                message:{id,type:"message",role:"assistant",model:publicModel,
                  content:[],stop_reason:null,stop_sequence:null,
                  usage:{input_tokens:0,output_tokens:0}}}));
            } else {
              controller.enqueue(sse("response.created",{type:"response.created",
                response:{id,object:"response",model:publicModel,status:"in_progress",output:[]}}));
            }
            started=true;
          }
          if (!tool.opened) {
            if (path === "/v1/messages") {
              controller.enqueue(sse("content_block_start",{type:"content_block_start",
                index:tool.outputIndex, content_block:{type:"tool_use",id:tool.callId,
                  name:tool.name,input:{}}}));
            } else {
              controller.enqueue(sse("response.output_item.added",{
                type:"response.output_item.added", output_index:tool.outputIndex,
                item:{type:"function_call",id:tool.itemId,call_id:tool.callId,name:tool.name,
                  arguments:"",status:"in_progress"},
              }));
            }
            tool.opened=true;
          }
          const delta = call.function?.arguments ?? "";
          if (!delta) return;
          tool.arguments += delta;
          if (path === "/v1/messages") {
            controller.enqueue(sse("content_block_delta",{type:"content_block_delta",
              index:tool.outputIndex, delta:{type:"input_json_delta",partial_json:delta}}));
          } else {
            controller.enqueue(sse("response.function_call_arguments.delta",{
              type:"response.function_call_arguments.delta", output_index:tool.outputIndex,
              item_id:tool.itemId, delta,
            }));
          }
        };
        for (const call of calls) emitTool(call);
        if (path==="/v1/messages") {
          if (!started) {
            controller.enqueue(sse("message_start",{type:"message_start",
              message:{id,type:"message",role:"assistant",model:publicModel,
                content:[],stop_reason:null,stop_sequence:null,
                usage:{input_tokens:0,output_tokens:0}}}));
            started=true;
          }
          if (text && !outputStarted) {
            textIndex = nextIndex++;
            controller.enqueue(sse("content_block_start",{type:"content_block_start",index:textIndex,
              content_block:{type:"text",text:""}}));
            outputStarted=true;
          }
          if (text) {
            output+=text;
            controller.enqueue(sse("content_block_delta",{type:"content_block_delta",index:textIndex,
              delta:{type:"text_delta",text}}));
          }
          if (finished && !finalEmitted) {
            if (outputStarted) controller.enqueue(sse("content_block_stop",
              {type:"content_block_stop",index:textIndex}));
            for (const tool of toolStates.values()) {
              controller.enqueue(sse("content_block_stop",
                {type:"content_block_stop",index:tool.outputIndex}));
            }
            controller.enqueue(sse("message_delta",{type:"message_delta",
              delta:{stop_reason:toolStates.size ? "tool_use" : "end_turn",stop_sequence:null},
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
            textIndex = nextIndex++;
            controller.enqueue(sse("response.output_item.added",
              {type:"response.output_item.added",output_index:textIndex,
                item:{id:"msg_"+id,type:"message",role:"assistant",status:"in_progress",content:[]}}));
            controller.enqueue(sse("response.content_part.added",
              {type:"response.content_part.added",output_index:textIndex,content_index:0,
                part:{type:"output_text",text:"",annotations:[]}}));
            outputStarted=true;
          }
          if (text) {
            output+=text;
            controller.enqueue(sse("response.output_text.delta",
              {type:"response.output_text.delta",output_index:textIndex,content_index:0,delta:text}));
          }
          if (finished && !finalEmitted) {
            if (outputStarted) controller.enqueue(sse("response.output_text.done",
              {type:"response.output_text.done",output_index:textIndex,content_index:0,text:output}));
            for (const tool of toolStates.values()) {
              controller.enqueue(sse("response.function_call_arguments.done",{
                type:"response.function_call_arguments.done", output_index:tool.outputIndex,
                item_id:tool.itemId, arguments:tool.arguments,
              }));
            }
            controller.enqueue(sse("response.completed",
              {type:"response.completed",response:{
                id,object:"response",model:publicModel,status:"completed",
                output:[...reasoningOutput(),
                  ...(output ? [{id:"msg_"+id,type:"message",role:"assistant",status:"completed",
                    content:[{type:"output_text",text:output,annotations:[]}]}] : []),
                  ...toolOutputs()],
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
            output:[...reasoningOutput(), {type:"message",role:"assistant",content:[{type:"output_text",text:output}]}]}}));
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
