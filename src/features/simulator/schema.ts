import { z } from "zod";
import { positiveVnd } from "@/lib/db/inputs";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date_format");

/**
 * Body of POST /api/simulations/purchase. Strict at every level: owner keys (`user_id`, `owner`, ...)
 * and any other unknown key are rejected with 400, never ignored. The owner comes only from the session.
 */
export const purchaseSimulationBodySchema = z
  .object({
    /** Positive integer VND as a decimal string (JSON numbers are rejected). */
    costVnd: positiveVnd,
    itemName: z.string().trim().max(80).optional(),
    buyNowDate: localDate.optional(),
    buyLater: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("date"), date: localDate }).strict(),
      z.object({ kind: z.literal("next_payday") }).strict(),
    ]),
  })
  .strict();

export type PurchaseSimulationBody = z.output<typeof purchaseSimulationBodySchema>;
