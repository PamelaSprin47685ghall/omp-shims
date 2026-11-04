// Prepared OMP extension-provider transports for stock OMP 18.14 gateways.
// These are supplied by the installed plugins themselves, not invented models.
const providers = new Map();
let kiroRefreshUntil = 0;
let kiroRefreshing;

export function publishExtensionProvider(id, config) {
  if ((id !== "kiro" && id !== "commandcode") || !config?.models ||
      typeof config.streamSimple !== "function") return;
  providers.set(id, { ...config, models: [...config.models] });
}

export function extensionProvider(id) {
  return providers.get(id);
}

export function extensionTraits(ref) {
  const sep = typeof ref === "string" ? ref.indexOf("/") : -1;
  if (sep <= 0) return undefined;
  const id = ref.slice(0, sep);
  const modelId = ref.slice(sep + 1);
  const cfg = providers.get(id);
  const model = cfg?.models.find(x => x.id === modelId);
  if (!model || !Number.isFinite(model.contextWindow) || model.contextWindow <= 0) return undefined;
  const efforts = Array.isArray(model.thinking?.efforts)
    ? model.thinking.efforts.filter(x => x !== "off" && x !== "none")
    : [];
  return {
    ref, provider: id,
    contextWindow: model.contextWindow,
    maxTokens: Number.isFinite(model.maxTokens) ? model.maxTokens : 0,
    // The shim PI-event adapter handles text and tool calls; image decoding
    // stays with stock OMP native providers until explicitly supported.
    input: ["text"],
    reasoning: model.reasoning === true,
    efforts, canDisable: model.reasoning === true && !model.thinking?.requiresEffort,
    ...(typeof model.baseUrl === "string" ? { baseUrl: model.baseUrl } : {}),
  };
}

export function extensionModelList() {
  const result = [];
  for (const [id, config] of providers) {
    for (const model of config.models ?? []) {
      const ref = id + "/" + model.id;
      const traits = extensionTraits(ref);
      if (!traits) continue;
      result.push({
        id: ref, object: "model", owned_by: id,
        api: config.api,
        context_length: traits.contextWindow,
        max_output_tokens: traits.maxTokens,
        input_modalities: traits.input,
      });
    }
  }
  return result;
}

export async function refreshExtensionProviders(credentials, now = Date.now()) {
  if (now < kiroRefreshUntil || kiroRefreshing) return kiroRefreshing;
  const cfg = providers.get("kiro");
  const row = credentials?.list?.().find(c => c.provider === "kiro");
  if (!cfg?.fetchDynamicModels || !row) return;
  kiroRefreshing = (async () => {
    const credential = await credentials.resolve(row.id);
    if (!credential) return;
    const fresh = await cfg.fetchDynamicModels(credential.secret);
    if (!Array.isArray(fresh) || !fresh.length) return;
    const current = providers.get("kiro");
    if (current) current.models = fresh;
    kiroRefreshUntil = Date.now() + 120_000;
  })().catch(() => {}).finally(() => { kiroRefreshing = undefined; });
  return kiroRefreshing;
}
