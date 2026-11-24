import type { PersonaCode } from "@/lib/db/schema";
import { readApiError } from "@/lib/http/client";
import { startGuestSession, type DemoClientDeps } from "./client";

/** Result of one guest start attempt, shaped for the UI state machine. */
export type GuestStartOutcome =
  | { kind: "started"; personaCode: PersonaCode; replaced: boolean }
  | { kind: "existing"; personaCode: PersonaCode | null }
  | { kind: "error"; code: string; message: string };

const SIGN_IN_FAILED =
  "Không thể tạo phiên Demo lúc này (đăng nhập ẩn danh có thể chưa được bật). Vui lòng thử lại hoặc đăng nhập bằng email.";
const NETWORK_FAILED = "Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.";
const UNEXPECTED_REPLY = "Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.";

const PERSONAS: readonly string[] = ["student", "worker", "at_risk"];
const asPersona = (value: unknown): PersonaCode | null =>
  typeof value === "string" && PERSONAS.includes(value) ? (value as PersonaCode) : null;

/** Wraps `startGuestSession` and never throws: every failure becomes an `error` outcome. */
export async function runGuestStart(
  deps: DemoClientDeps,
  personaCode: PersonaCode,
  options: { confirmReplace?: boolean; reuseSession?: boolean } = {},
): Promise<GuestStartOutcome> {
  let outcome;
  try {
    outcome = await startGuestSession(deps, personaCode, options);
  } catch {
    return { kind: "error", code: "network", message: NETWORK_FAILED };
  }
  if (!outcome.ok) {
    if (outcome.status === 401 && !hasEnvelopeMessage(outcome.body) && !options.reuseSession) {
      return { kind: "error", code: "unauthenticated", message: SIGN_IN_FAILED };
    }
    const info = readApiError(outcome.body);
    return { kind: "error", code: info.code, message: info.message };
  }
  const body = (typeof outcome.body === "object" && outcome.body !== null ? outcome.body : {}) as {
    status?: unknown;
    personaCode?: unknown;
  };
  if (body.status === "existing") return { kind: "existing", personaCode: asPersona(body.personaCode) };
  const persona = asPersona(body.personaCode);
  if ((body.status === "started" || body.status === "replaced") && persona) {
    return { kind: "started", personaCode: persona, replaced: body.status === "replaced" };
  }
  return { kind: "error", code: "internal", message: UNEXPECTED_REPLY };
}

function hasEnvelopeMessage(body: unknown): boolean {
  const error = typeof body === "object" && body !== null ? (body as { error?: { message?: unknown } }).error : undefined;
  return typeof error?.message === "string" && error.message.length > 0;
}

/**
 * Synchronous re-entrancy lock. React state updates are asynchronous, so a fast double click can
 * fire two handlers before `disabled` renders; this guard rejects the second one immediately.
 */
export function createSubmitGuard() {
  let busy = false;
  return {
    tryEnter(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave(): void {
      busy = false;
    },
    get busy(): boolean {
      return busy;
    },
  };
}
