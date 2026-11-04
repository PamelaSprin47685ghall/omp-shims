// Public Gateway accepts configured lazy/* routes only.
// Internal LazyRouter attempts use the captured host handler directly.
const WRITES = new Set(["POST","PUT","PATCH"]);

export function allowedClientModel(model, router) {
  return typeof model === "string" && model.startsWith("lazy/")
    && typeof router?.handles === "function" && router.handles(model) === true;
}

export function disallowedClientModelRequest({ method, pathname, body, router, supportedFormat }) {
  if (!WRITES.has(method)) return false;
  const versioned = pathname === "/v1" || pathname.startsWith("/v1/");
  const named = body !== null && typeof body === "object"
    && Object.hasOwn(body, "model");
  if (!versioned && !named) return false;
  return !(method === "POST" && supportedFormat
    && allowedClientModel(body?.model, router));
}

export function forbiddenModelResponse() {
  return Response.json({ error: {
    type:"model_not_allowed", message:"Only configured lazy/* models may be requested.",
  } }, { status:403, headers:{"cache-control":"no-store"} });
}

export async function lazyOnlyModelCatalog(response, entries) {
  if (response?.status !== 200) return response;
  let data;
  try { data = await response.clone().json(); } catch { return malformed(); }
  if (!data || !Array.isArray(data.data)) return malformed();
  const seen = new Set();
  const allowed = [];
  for (const item of entries ?? []) {
    if (!item || typeof item.id !== "string" || !item.id.startsWith("lazy/")
      || seen.has(item.id)) continue;
    allowed.push(item);
    seen.add(item.id);
  }
  const headers = new Headers(response.headers);
  for (const name of ["content-length","content-encoding","etag"]) headers.delete(name);
  headers.set("cache-control","no-store");
  return new Response(JSON.stringify({...data,data:allowed}),{status:200,headers});
}

function malformed() {
  return Response.json({error:{type:"catalog_unavailable"}},{
    status:502,headers:{"cache-control":"no-store"}});
}
