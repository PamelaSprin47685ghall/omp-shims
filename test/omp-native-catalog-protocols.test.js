import { describe, expect, test } from "bun:test";
import { ModelCatalog } from "../lib/lazy-router/catalog.js";
import { requestAsChat, convertChatJson, convertChatResponse } from "../lib/lazy-router/protocol-interoperability.js";

describe("stock OMP 18.14 gateway model catalog as shim fallback", () => {
  test("accepts only authentic catalog model rows with capabilities", () => {
    const c=new ModelCatalog();
    expect(c.ready).toBe(false);
    const ok=c.ingestGatewayModels([
      {id:"opencode-go/deepseek-v4.1-flash",object:"model",
        owned_by:"opencode-go",context_length:1_000_000,
        max_output_tokens:384_000,input_modalities:["text","image"]},
      {id:"fake/no-capabilities",object:"model"},
      {id:"lazy/task",object:"model",owned_by:"lazy-router",
        context_length:500000,max_output_tokens:64000,input_modalities:["text"]},
    ]);
    expect(ok).toBe(true);
    expect(c.ready).toBe(true);
    expect(c.hasNativeModel("opencode-go/deepseek-v4.1-flash")).toBe(true);
    expect(c.find("opencode-go/deepseek-v4.1-flash").contextWindow).toBe(1_000_000);
    expect(c.find("fake/no-capabilities")).toBeUndefined();
    expect(c.hasNativeModel("lazy/task")).toBe(false);
  });

  test("invalid snapshots never clear valid known model metadata", () => {
    const c=new ModelCatalog();
    c.ingestGatewayModels([{id:"openai-codex/gpt-6.1-terra",object:"model",
      owned_by:"openai-codex",context_length:500000,
      max_output_tokens:128000,input_modalities:["text"]}]);
    expect(c.ingestGatewayModels(null)).toBe(false);
    expect(c.find("openai-codex/gpt-6.1-terra")).toBeDefined();
  });
});

describe("shared bridge dialects are explicit and preserve usage", () => {
  const body={id:"chatcmpl1",created:1,choices:[{index:0,finish_reason:"stop",
    message:{role:"assistant",content:"OK"}}],
    usage:{prompt_tokens:100,completion_tokens:2,total_tokens:102,
      prompt_tokens_details:{cached_tokens:90}}};
  test("converts Anthropic system and tool response without discarding it", () => {
    const chat=requestAsChat("/v1/messages",{
      model:"mistral-vibe/deepseek-v4-1-flash-1017",
      messages:[{role:"user",content:[{type:"tool_result",tool_use_id:"call1",
        content:"4"}]}],
      system:"Be concise",max_tokens:64,
    });
    expect(chat.messages[0]).toEqual({role:"system",content:"Be concise"});
    expect(chat.messages[1]).toEqual({role:"tool",tool_call_id:"call1",content:"4"});
  });
  test("converts Responses function call history", () => {
    const chat=requestAsChat("/v1/responses",{model:"mistral-vibe/x",
      input:[{type:"function_call",call_id:"call1",name:"calc",arguments:"{}"},
        {type:"function_call_output",call_id:"call1",output:"4"}]});
    expect(chat.messages[0].tool_calls[0].function.name).toBe("calc");
    expect(chat.messages[1].role).toBe("tool");
  });
  test("unknown multimodal payload never silently loses content", () => {
    expect(()=>requestAsChat("/v1/messages",{model:"mistral-vibe/x",
      messages:[{role:"user",content:[{type:"image",source:{}}]}]})).toThrow();
  });
  test("Anthropic and Responses nonstream results preserve cached tokens", () => {
    const a=convertChatJson("/v1/messages",body,"lazy/task");
    expect(a.model).toBe("lazy/task");
    expect(a.usage.cache_read_input_tokens).toBe(90);
    const r=convertChatJson("/v1/responses",body,"lazy/task");
    expect(r.output[0].content[0].text).toBe("OK");
    expect(r.usage.input_tokens_details.cached_tokens).toBe(90);
  });
  test("Chat SSE becomes both Messages and Responses with valid terminal event", async () => {
    const source=new Response(
      'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\n'
      +'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      +'data: [DONE]\n\n',
      {headers:{"content-type":"text/event-stream"}});
    const a=await convertChatResponse("/v1/messages",source,"lazy/task");
    const text=await a.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");
    const b=await convertChatResponse("/v1/responses",new Response(
      'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
      {headers:{"content-type":"text/event-stream"}}),"lazy/task");
    expect(await b.text()).toContain("event: response.completed");
  });
});
