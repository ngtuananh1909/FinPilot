import { requireOwner } from "@/lib/auth/owner-context";
import { getAiRuntimeConfig } from "@/lib/ai/config";
import { getPublicEnv } from "@/lib/config/public-env";
import { getServerEnv } from "@/lib/config/server-env";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http/request";
import { extractReceiptForOwner } from "@/lib/receipts/extract";
import { assertReceiptImage, readReceiptBytes } from "@/lib/receipts/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: the raw image bytes with Content-Type image/jpeg | image/png | image/webp (max
 * RECEIPT_MAX_BYTES, 5 MiB by default). The type is checked against the file's magic bytes.
 * Returns an editable draft only; saving is a separate, explicit POST /api/transactions with
 * source "receipt". The image is held in memory for this request and never stored or logged.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const image = await readReceiptBytes(request, getServerEnv().RECEIPT_MAX_BYTES);
    const mimeType = assertReceiptImage(request.headers.get("content-type"), image);
    const config = getAiRuntimeConfig(undefined, getPublicEnv().NEXT_PUBLIC_APP_URL);
    const result = await extractReceiptForOwner(
      { client: supabase, admin: createSupabaseAdminClient(), config },
      owner,
      image,
      mimeType,
      new Date(),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
