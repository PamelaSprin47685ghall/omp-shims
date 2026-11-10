// Gateway-administrator bearer check shared by the router and the fallbacks.
// The token lives in ~/.omp/auth-gateway.token and never leaves this process.

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * True when the request presents the gateway token as a bearer credential.
 * A missing or unreadable token file never authorises a request.
 */
export function adminTokenMatches(request, tokenPath) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request?.headers?.get?.("authorization") ?? "");
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
