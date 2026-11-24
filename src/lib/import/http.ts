import { ImportError } from "./errors";
import type { CsvLimits } from "./limits";

/**
 * Largest JSON request body for an import route: the CSV text can double when JSON-escaped
 * (quotes, line breaks), plus room for mapping and up to 5000 row ids.
 */
export const importBodyCap = (limits: CsvLimits): number => limits.maxBytes * 2 + 512 * 1024;

/**
 * Reads a JSON object body while enforcing `maxBytes` DURING the read (a missing or false
 * Content-Length cannot make the server buffer an oversize upload). Rejects with 413 on overflow.
 */
export async function readCappedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ImportError("payload_too_large", { httpStatus: 413 });
  }
  if (!request.body) throw new ImportError("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ImportError("payload_too_large", { httpStatus: 413 });
    }
    chunks.push(value);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ImportError("invalid_encoding");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError("invalid_request");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ImportError("invalid_request");
  }
  return parsed;
}
