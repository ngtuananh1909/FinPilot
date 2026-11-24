import { DbError } from "../../errors";

/**
 * Refuses to run in a browser. The service-role key is also unavailable client-side
 * (not NEXT_PUBLIC_), but privileged wrappers fail closed even if imported by mistake.
 */
export function assertServerRuntime(): void {
  if (typeof window !== "undefined") throw new DbError("server_only");
}
