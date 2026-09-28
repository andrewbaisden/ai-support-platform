/**
 * Refuse to serve production traffic with unsafe configuration. Runs once
 * per server instance before it accepts requests; never during `next build`.
 * The Node-only check is imported inside the runtime condition so it is
 * left out of the edge bundle (it loads the database package's env helper).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionConfig } = await import("./instrumentation-node");
    assertProductionConfig();
  }
}
