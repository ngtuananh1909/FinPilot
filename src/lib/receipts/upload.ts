import { AppError } from "@/lib/errors";
import type { ReceiptMimeType } from "@/lib/ai/provider";

/** Smallest plausible image; anything shorter cannot be a real photo of a receipt. */
export const MIN_RECEIPT_BYTES = 64;

const tooLarge = (maxBytes: number) =>
  new AppError("validation_failed", {
    httpStatus: 413,
    userMessage: `Ảnh quá lớn. Kích thước tối đa là ${Math.floor(maxBytes / 1_048_576)} MB.`,
    safeDetails: { reason: "receipt_too_large" },
  });

const badImage = (reason: string) =>
  new AppError("validation_failed", {
    httpStatus: 415,
    userMessage: "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.",
    safeDetails: { reason },
  });

/**
 * Reads the raw image body, enforcing the byte cap WHILE reading (a missing or false
 * Content-Length cannot make the server buffer more). The bytes stay in memory only.
 */
export async function readReceiptBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) throw badImage("receipt_empty");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  if (total < MIN_RECEIPT_BYTES) throw badImage("receipt_empty");
  return new Uint8Array(Buffer.concat(chunks));
}

/** Detects the real image type from magic bytes. File names and declared types are not trusted. */
export function sniffImageType(bytes: Uint8Array): ReceiptMimeType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Declared Content-Type must be an allowed image type AND match the sniffed bytes. */
export function assertReceiptImage(declared: string | null, bytes: Uint8Array): ReceiptMimeType {
  const type = (declared ?? "").split(";")[0]!.trim().toLowerCase();
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw badImage("receipt_not_an_image");
  if (type !== sniffed) throw badImage("receipt_type_mismatch");
  return sniffed;
}
