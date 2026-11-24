// Manual capability probe (docs/07): sends two tiny real requests (one tool call, one 1x1 image)
// to the configured provider and prints booleans only. Never run per user request.
//   npm run ai:probe
// Prints no keys, URLs or model output. Exit codes: 0 probed, 3 BLOCKED (not configured), 1 error.
import { getServerEnv } from "../config/server-env";
import { getAiRuntimeConfig } from "./config";
import { ProviderAmbiguousError, ProviderPreResultError } from "./errors";
import { createProvider } from "./provider";

async function main(): Promise<number> {
  let config;
  try {
    config = getAiRuntimeConfig(getServerEnv(process.env), null);
  } catch (error) {
    const details = (error as { safeDetails?: Record<string, unknown> }).safeDetails ?? {};
    console.log(`BLOCKED: AI is not configured (missing: ${String(details.missing ?? details.variable ?? "unknown")})`);
    return 3;
  }
  console.log(`provider=${config.provider} configured=true`);
  try {
    const caps = await createProvider(config).checkCapabilities();
    console.log(`tools=${caps.tools} vision=${caps.vision}`);
    return 0;
  } catch (error) {
    if (error instanceof ProviderPreResultError) console.log(`error=pre_result:${error.reason} status=${error.providerStatus ?? "none"}`);
    else if (error instanceof ProviderAmbiguousError) console.log(`error=ambiguous:${error.reason}`);
    else console.log("error=unexpected");
    return 1;
  }
}

main().then((code) => process.exit(code));
