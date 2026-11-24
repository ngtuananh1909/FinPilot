import { requireOwner } from "@/lib/auth/owner-context";
import { isDbError } from "@/lib/db/errors";
import { requireProfile } from "@/lib/db/repositories/profile";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toAppError } from "@/lib/errors";
import { FORECAST_HORIZON_DAYS, addDays, localDateOf, vndToString } from "@/lib/finance";
import type { SimulatorState } from "./SimulatorView";

export type SimulatorLoad = { kind: "unauthenticated" } | SimulatorState;

/** Server data for /simulator: today's window and the current reserve. Reads one profile row. */
export async function loadSimulator(now: Date = new Date()): Promise<SimulatorLoad> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const profile = await requireProfile(supabase, owner);
    const today = localDateOf(now);
    return {
      kind: "ready",
      bounds: { min: today, max: addDays(today, FORECAST_HORIZON_DAYS - 1) },
      reserveVnd: vndToString(profile.minimumReserveVnd),
    };
  } catch (error) {
    if (isDbError(error) && error.reason === "profile_missing") {
      return { kind: "empty", message: "Chưa có hồ sơ tài chính. Hãy nhập số dư và thông tin cơ bản để mô phỏng." };
    }
    const app = toAppError(error);
    if (app.code === "unauthenticated") return { kind: "unauthenticated" };
    console.error(`[simulator] ${app.code}`);
    const reason = app.safeDetails?.reason;
    return { kind: "error", message: app.userMessage, code: typeof reason === "string" ? reason : app.code };
  }
}
