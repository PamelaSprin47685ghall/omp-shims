// Official list-price API equivalent, not a bill or provider subscription cost.
// Captures the publicly documented USD rates valid as of 2026-10-29.
// Exact per-model mappings only: never guess a rate for an unknown model.
// Costs shown in USD per 1,000,000 tokens, separated by input/cache/output.
// Model families routed via third-party subscriptions are priced at the ORIGINAL
// model vendor's published API reference price, not the reseller's charges.
//
// Historical TokenTotals rows do not contain request timestamps. DeepSeek's
// official 2026 peak reference rate is used for every historical DeepSeek row.
// Extra tool/search fees, cache-write surcharges, regional uplift and long-
// context multipliers are NOT inferred from aggregate usage and are excluded.

const MISTRAL_GLM = "https://docs.mistral.ai/models/zai-glm-5-3-flash";
const MISTRAL_DS = "https://docs.mistral.ai/models/deepseek-v4-flash-1017";
const MISTRAL_SMALL = "https://docs.mistral.ai/inference/pricing";
const OPENAI = "https://developers.openai.com/api/docs/models/gpt-6.1-terra";
const DEEPSEEK = "https://api-docs.deepseek.com/quick_start/pricing/";
const CLAUDE = "https://platform.claude.com/docs/en/about-claude/pricing";
const GEMINI = "https://ai.google.dev/gemini-api/docs/latest-model";
const GEMINI_FLASH = "https://ai.google.dev/gemini-api/docs/pricing";
const ZAI = "https://docs.z.ai/guides/overview/pricing";
const XAI = "https://docs.x.ai/developers/models/grok-4.7";
const OPENAI_SOL = "https://developers.openai.com/api/docs/models/gpt-6.1-sol";
const OPENAI_PRICE = "https://developers.openai.com/api/docs/pricing";

function rate(input, cached, output, source, basis) {
  return Object.freeze({ input, cached, output, source, basis });
}
const PUBLISHED = Object.freeze({
  // Official Mistral-hosted API list rate.
  "mistral-vibe/zai-glm-5-3-flash": rate(0.15, 0.03, 0.50, MISTRAL_GLM, "Mistral API"),
  "mistral-vibe/zai-glm-5-3": rate(1.40, 0.14, 4.40,
    "https://docs.mistral.ai/models/zai-glm-5-3", "Mistral API；非 Z.ai 直连价"),
  "mistral-vibe/deepseek-v4-1-flash-1017": rate(0.30, 0.007, 1.20, MISTRAL_DS, "Mistral API"),
  "mistral-vibe/mistral-small-latest": rate(0.15, 0.015, 0.60, MISTRAL_SMALL, "Mistral API"),
  // Codex is a subscription: API STANDARD list price is ONLY an equivalent value.
  "openai-codex/gpt-6.1-terra": rate(1.00, 0.05, 5.00, OPENAI, "OpenAI API 标准等效（Codex 非实际账单）"),
  "openai-codex/gpt-6.1-sol": rate(2.00, 0.10, 10.00, OPENAI_SOL,
    "OpenAI API Standard 等效；Codex 订阅非实际账单；不含 >272K 输入附加费"),
  "openai-codex/gpt-6-astra": rate(10.00, 1.00, 50.00, OPENAI_PRICE,
    "OpenAI API Standard 等效；Codex 订阅非实际账单；不含长上下文附加费"),
  "openai-codex/gpt-6-luna": rate(0.10, 0.01, 0.50, OPENAI_PRICE,
    "OpenAI API Standard 等效；Codex 订阅非实际账单；不含长上下文附加费"),
  // Explicit /v1/responses Flex tier, 50% of standard list.
  "openai-api/gpt-6.1-terra": rate(0.50, 0.025, 2.50, OPENAI, "OpenAI API Flex（不含长上下文加价）"),
  // CTYun is a third-party channel; map its known model IDs to their
  // original developer's public list price, not CTYun's actual invoice.
  "ctyun/glm-5.3-oc": rate(1.40, 0.26, 4.40, ZAI,
    "Z.ai GLM-5.3 官方 API 参考价；CTYun -oc 通道非实际账单"),
  "ctyun/glm-5.3-flash": rate(0.15, 0.03, 0.50, ZAI,
    "Z.ai GLM-5.3-Flash 官方 API 参考价；非 CTYun 账单"),
  // Third-party providers: official DEEPSEEK API PEAK reference only.
  "ctyun/deepseek-v4.1-flash": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非 CTYun 账单"),
  "charm-hyper/deepseek-v4.1-flash-1017": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  "opencode-go/deepseek-v4.1-flash": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  // Command Code confirms the same hourly peak/off-peak DeepSeek pricing.
  // Historical usage lacks timestamps; this is peak reference, not actual bill.
  "commandcode/deepseek/deepseek-v4.1-flash": rate(0.30, 0.006, 1.20,
    "https://commandcode.ai/docs/resources/pricing-limits",
    "Command Code DeepSeek V4.1 Flash 峰时参考价；实际按时段计费"),
  "ollama-cloud/deepseek-v4.1-flash:1017": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  "cline-pass/deepseek-v4.1-flash-1017": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  // Anthropic Claude Opus 5.5 standard global API price, independent of reseller.
  "kiro/claude-opus-5-5": rate(4.00, 0.20, 20.00, CLAUDE, "Anthropic API 标准等效"),
  "google-antigravity/claude-opus-5-5": rate(4.00, 0.20, 20.00, CLAUDE, "Anthropic API 标准等效"),
  // Google introductory list price valid until 2026-11-30; review thereafter.
  "google-antigravity/gemini-4-argon": rate(2.00, 0.10, 10.00, GEMINI, "Google API 2026-11-30 前参考价"),
  "google-antigravity/gemini-3.8-flash": rate(0.75, 0.075, 3.75, GEMINI_FLASH,
    "Google API 2026-12-31 前参考价；不含缓存存储费"),
  "xai-oauth/grok-4.7": rate(2.00, 0.50, 6.00, XAI,
    "xAI API <200K 输入参考价；不含 ≥200K 长上下文加价"),
});

const tok = (x) => Number.isSafeInteger(x) && x >= 0 ? x : 0;
const usd = (n) => Math.round(n * 1e8) / 1e8;
export const OFFICIAL_RATE_DATE = "2026-10-29";

/** No inferred price for unknown models. Historical rates are current reference,
 * not historical invoices. Token totals come exclusively from provider usage. */
export function officialApiEquivalent(rows = []) {
  const models = [];
  let amount = 0;
  let unpricedModels = 0;
  for (const row of rows) {
    if (typeof row?.model !== "string") continue;
    const input = tok(row.uncachedInput);
    const cachedInput = tok(row.cachedInput);
    const output = tok(row.output);
    const price = PUBLISHED[row.model];
    if (!price) {
      unpricedModels++;
      models.push({ model: row.model, priced: false, valueUsd: null, source: null,
        basis: "无可靠官方价格，未计价" });
      continue;
    }
    const valueUsd = usd((input * price.input + cachedInput * price.cached
      + output * price.output) / 1_000_000);
    amount += valueUsd;
    models.push({ model: row.model, priced: true, valueUsd,
      source: price.source, basis: price.basis,
      perMillion: { uncachedInput: price.input, cachedInput: price.cached, output: price.output } });
  }
  models.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  return {
    currency: "USD", valueUsd: usd(amount),
    pricedModels: models.length - unpricedModels, totalModels: models.length,
    unpricedModels, models, ratesAsOf: OFFICIAL_RATE_DATE,
    note: "按各模型开发商官方 API 价格估算，非订阅或第三方渠道实际账单。历史 DeepSeek 统一按高峰价；OpenAI、xAI 的长上下文附加费、Google 缓存存储费、工具费用及缓存写入费用无法从模型累计 Token 还原，均未计入。",
  };
}
