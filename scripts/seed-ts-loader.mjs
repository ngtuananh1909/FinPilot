// Minimal resolver for running src/lib/demo/seed-cli.ts with plain Node (type stripping).
// Maps the "@/..." alias to src/ and resolves extensionless relative imports to .ts files.
// Needs Node >= 22.15 (module.registerHooks) with --experimental-strip-types (default on in newer Node).
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

function tryResolveTs(basePath) {
  const candidates = [`${basePath}.ts`, `${basePath}/index.ts`];
  for (const file of candidates) {
    if (existsSync(file) && statSync(file).isFile()) return pathToFileURL(file).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let basePath = null;
    if (specifier.startsWith("@/")) {
      basePath = srcRoot + specifier.slice(2);
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file://") &&
      fileURLToPath(context.parentURL).startsWith(srcRoot) &&
      !/\.[cm]?[jt]s$|\.json$/.test(specifier)
    ) {
      basePath = fileURLToPath(new URL(specifier, context.parentURL));
    }
    if (basePath !== null) {
      const url = tryResolveTs(basePath);
      if (url) return nextResolve(url, context);
    }
    return nextResolve(specifier, context);
  },
});
