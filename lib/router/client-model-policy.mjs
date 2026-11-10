// Client model selection policy.
//
// The router owns a small set of opaque route ids. A client may ask for one of
// them. Any other model passes through to the gateway unchanged, unless the
// configured `clientOnlyPrefix` marks a name as an attempted route id that the
// router does not know. That last case is a client error, not a model request.

/** True when `model` is one of the router's route ids. */
export function allowedClientModel(model, router) {
  return typeof model === "string" && typeof router?.handles === "function" && router.handles(model) === true;
}

/**
 * True when a request must be rejected instead of passed through.
 *
 * A lazy route is handled by the router and never reaches this check as a
 * rejection. A non-route model passes through. Only a name that starts with the
 * configured route prefix and is not a configured route is rejected, because it
 * asks for a route that does not exist.
 */
export function disallowedClientModelRequest({ method, body, router, clientOnlyPrefix, supportedFormat }) {
  if (method !== "POST" || !supportedFormat) return false;
  const model = body?.model;
  if (typeof model !== "string" || model === "") return false;
  if (allowedClientModel(model, router)) return false;
  if (typeof clientOnlyPrefix !== "string" || clientOnlyPrefix === "") return false;
  return model.startsWith(clientOnlyPrefix);
}

/** The answer for an unknown route id. It names no account and no upstream. */
export function forbiddenModelResponse() {
  return Response.json(
    {
      error: {
        type: "model_not_allowed",
        message: "Only configured route ids may be requested.",
      },
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
