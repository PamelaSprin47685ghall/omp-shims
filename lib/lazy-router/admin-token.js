// Gateway-administrator bearer check shared by the provider fallbacks.
// The token lives in ~/.omp/auth-gateway.token and never leaves this process.
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export function adminTokenMatches(request, tokenPath) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  let expected;
  try {
    expected = readFileSync(tokenPath, "utf8").trim();
  } catch {
    return false;
  }
  if (!expected) return false;
  const actual = Buffer.from(match[1]);
  const trusted = Buffer.from(expected);
  return actual.length === trusted.length && timingSafeEqual(actual, trusted);
}
