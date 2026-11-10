// Official list-price API equivalent, not a bill or provider subscription cost.
// Policy data lives in presets/rates.json: asOf, note, and one rate entry per
// provider/model. This module only reads it; edit prices there, never here.
// Captures the publicly documented USD rates valid as of the preset's asOf date.
// Exact per-model mappings only: never guess a rate for an unknown model.
// Costs shown in USD per 1,000,000 tokens, separated by input/cache/output.
// Model families routed via third-party subscriptions are priced at the ORIGINAL
// model vendor's published API reference price, not the reseller's charges.
//
// Historical TokenTotals rows do not contain request timestamps. Where a rate
// carries a peak/off-peak schedule, the official peak reference rate is used for
// every historical row. Extra tool/search fees, cache-write surcharges, regional
// uplift and long-context multipliers are NOT inferred from aggregate usage and
// are excluded.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("../../presets/rates.json", import.meta.url), "utf8"));

function rate(input, cached, output, source, basis) {
  return Object.freeze({ input, cached, output, source, basis });
}

/** Per-model rates keyed by provider/model, frozen once at module load. */
const PUBLISHED = Object.freeze(
  Object.fromEntries(
    Object.entries(DATA.rates ?? {}).map(([model, price]) => [
      model,
      rate(price.input, price.cached, price.output, price.source, price.basis),
    ]),
  ),
);

const NOTE = DATA.note ?? "";
const tok = (x) => (Number.isSafeInteger(x) && x >= 0 ? x : 0);
const usd = (n) => Math.round(n * 1e8) / 1e8;
export const OFFICIAL_RATE_DATE = DATA.asOf;

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
      models.push({ model: row.model, priced: false, valueUsd: null, source: null, basis: "无可靠官方价格，未计价" });
      continue;
    }
    const valueUsd = usd((input * price.input + cachedInput * price.cached + output * price.output) / 1_000_000);
    amount += valueUsd;
    models.push({
      model: row.model,
      priced: true,
      valueUsd,
      source: price.source,
      basis: price.basis,
      perMillion: { uncachedInput: price.input, cachedInput: price.cached, output: price.output },
    });
  }
  models.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  return {
    currency: "USD",
    valueUsd: usd(amount),
    pricedModels: models.length - unpricedModels,
    totalModels: models.length,
    unpricedModels,
    models,
    ratesAsOf: OFFICIAL_RATE_DATE,
    note: NOTE,
  };
}
