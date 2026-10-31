// Broker-independent models.yml providers for stock OMP Gateway 18.14.
// Never send credentials to a different origin or alter OMP's configured providers.
import {
  extractCustomProviders, findModelsPath, loadModelsConfig,
} from "../../features/models-bridge.js";
import { requestAsChat, convertChatResponse } from "./protocol-interoperability.js";
import { chatAsResponses, responsesAsChat as typedResponsesAsChat, responsesSseAsChat } from "./responses-wire.js";
import { adminTokenMatches } from "./mistral-native-fallback.js";

const ALLOWED_APIS = new Set(["openai-completions", "openai-responses"]);
// Never proxy our own Gateway or arbitrary custom endpoints.
const ALLOWED_PROVIDERS = new Set(["ctyun", "openai-api"]);

function providerConfigs() {
  const path = findModelsPath();
  if (!path) return new Map();
  const configs = new Map();
  for (const { name, config } of extractCustomProviders(loadModelsConfig(path))) {
    if (!ALLOWED_PROVIDERS.has(name)) continue;
    if (!ALLOWED_APIS.has(config.api) || typeof config.apiKey !== "string" ||
        !config.apiKey || !Array.isArray(config.models)) continue;
    let url;
    try { url = new URL(config.baseUrl); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash) continue;
    for (const model of config.models) {
      if (typeof model.id !== "string" || !model.id) continue;
      const ref = name + "/" + model.id;
      configs.set(ref, { name, model, config, base: url });
    }
  }
  return configs;
}

const CONFIGURED = providerConfigs();

export function customModelTraits(ref) {
  const found = CONFIGURED.get(ref);
  if (!found) return undefined;
  const model=found.model;
  const efforts=Array.isArray(model.thinking?.efforts) ? model.thinking.efforts : [];
  return { ref, provider:found.name, contextWindow:model.contextWindow,
    maxTokens:model.maxTokens, input:model.input ?? ["text"],
    reasoning:model.reasoning === true, efforts, canDisable:!model.thinking?.requiresEffort };
}

export function customModelList() {
  return [...CONFIGURED].map(([id,{name,model,config}])=>({
    id, object:"model", owned_by:name, api:config.api,
    context_length:model.contextWindow,
    max_output_tokens:model.maxTokens, input_modalities:model.input ?? ["text"],
  }));
}

export function withCustomProviderFallback(handler, {
  tokenPath, fetchImpl=globalThis.fetch, nativeRegistered=()=>false,
  configured = CONFIGURED,
}) {
  return async (request,server) => {
    if (request.method!=="POST") return handler(request,server);
    const path=new URL(request.url).pathname;
    if (!["/v1/chat/completions","/v1/responses","/v1/messages"].includes(path)) {
      return handler(request,server);
    }
    let body;
    try {body=await request.clone().json();}catch{return handler(request,server);}
    const found=configured.get(body?.model);
    if(!found || nativeRegistered(body.model) ||
       !adminTokenMatches(request,tokenPath)) return handler(request,server);
    let chat;
    try {chat=requestAsChat(path,body);}catch{
      return Response.json({error:{type:"invalid_request_error",
        message:"Unsupported request shape for custom provider"}},{status:422});
    }
    const upstreamBody=found.config.api==="openai-responses"
      ? chatAsResponses(chat, found.model.id, { flex: found.name === "openai-api" })
      : { ...chat, model: found.model.id };
    const base=new URL(found.base);
    // Explicitly stay on the configured provider's URL and API path.
    base.pathname=base.pathname.replace(/\/+$/,"")+
      (found.config.api==="openai-responses"?"/responses":"/chat/completions");
    const authHeaders={"content-type":"application/json",
      authorization:"Bearer "+found.config.apiKey};
    const upstream=await fetchImpl(base.toString(),{
      method:"POST",headers:authHeaders,
      body:JSON.stringify(upstreamBody),signal:request.signal});
    if (!upstream.ok) return upstream;
    if(found.config.api==="openai-completions") {
      return convertChatResponse(path,upstream,body.model);
    }
    if (path === "/v1/responses") return upstream;
    const streamed = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    const response = streamed
      ? responsesSseAsChat(upstream, body.model)
      : Response.json(typedResponsesAsChat(await upstream.json(), body.model));
    return convertChatResponse(path, response, body.model);
  };
}
