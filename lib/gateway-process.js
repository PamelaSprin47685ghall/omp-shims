// Which omp process is this?
//
// shims.json is shared by the auth-gateway, the auth-broker and interactive
// sessions. Features that change what the gateway answers (lazy models, the
// status page, SSE keep-alives) must stay off everywhere else.

/** The subcommand that serves the gateway. */
const GATEWAY_COMMAND = "auth-gateway";

/** True in the auth-gateway process. */
export function isGatewayProcess(argv = process.argv) {
  return argv.includes(GATEWAY_COMMAND);
}
