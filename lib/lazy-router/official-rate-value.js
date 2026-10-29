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

function rate(input, cached, output, source, basis) {
  return Object.freeze({ input, cached, output, source, basis });
}
const PUBLISHED = Object.freeze({
  // Official Mistral-hosted API list rate.
  "mistral-vibe/zai-glm-5-3-flash": rate(0.15, 0.03, 0.50, MISTRAL_GLM, "Mistral API"),
  "mistral-vibe/deepseek-v4-1-flash-1017": rate(0.30, 0.007, 1.20, MISTRAL_DS, "Mistral API"),
  "mistral-vibe/mistral-small-latest": rate(0.15, 0.015, 0.60, MISTRAL_SMALL, "Mistral API"),
  // Codex is a subscription: API STANDARD list price is ONLY an equivalent value.
  "openai-codex/gpt-6.1-terra": rate(1.00, 0.05, 5.00, OPENAI, "OpenAI API 标准等效（Codex 非实际账单）"),
  // Explicit /v1/responses Flex tier, 50% of standard list.
  "openai-api/gpt-6.1-terra": rate(0.50, 0.025, 2.50, OPENAI, "OpenAI API Flex（不含长上下文加价）"),
  // Third-party providers: official DEEPSEEK API PEAK reference only.
  "ctyun/deepseek-v4.1-flash": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非 CTYun 账单"),
  "charm-hyper/deepseek-v4.1-flash-1017": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  "opencode-go/deepseek-v4.1-flash": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  "ollama-cloud/deepseek-v4.1-flash:1017": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  "cline-pass/deepseek-v4.1-flash-1017": rate(0.30, 0.006, 1.20, DEEPSEEK, "DeepSeek 官方高峰参考价；非渠道账单"),
  // Anthropic Claude Opus 5.5 standard global API price, independent of reseller.
  "kiro/claude-opus-5-5": rate(4.00, 0.20, 20.00, CLAUDE, "Anthropic API 标准等效"),
  "google-antigravity/claude-opus-5-5": rate(4.00, 0.20, 20.00, CLAUDE, "Anthropic API 标准等效"),
  // Google introductory list price valid until 2026-11-30; review thereafter.
  "google-antigravity/gemini-4-argon": rate(2.00, 0.10, 10.00, GEMINI, "Google API 2026-11-30 前参考价"),
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
    note: "当前官方模型 API 公开价等效估算，非订阅/渠道实际账单。历史 DeepSeek 使用官方高峰参考价；不含工具、缓存写入、区域与长上下文附加费用。",
  };
}
