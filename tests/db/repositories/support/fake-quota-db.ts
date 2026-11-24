import type { FakeResult, RpcResponder } from "./fake-client";

/**
 * In-memory model of the PROPOSED quota RPCs, transcribed from
 * supabase/proposed/202611230002_finpilot_hardening.sql (sections 6b-6d). It exists to test
 * the TypeScript wrapper's call sequence. It is NOT evidence that the SQL behaves this way:
 * that needs the live suite (blocked until G2).
 */
export class FakeQuotaDb {
  readonly reservations = new Map<string, { userId: string; kind: string; status: "reserved" | "released" | "committed" }>();
  readonly usage = new Map<string, { chat: number; scan: number }>();
  readonly log: string[] = [];
  failRelease = false;
  failCommit = false;

  private bucket(userId: string) {
    let b = this.usage.get(userId);
    if (!b) this.usage.set(userId, (b = { chat: 0, scan: 0 }));
    return b;
  }
  used(userId: string, kind: "chat" | "scan") {
    return this.usage.get(userId)?.[kind] ?? 0;
  }

  readonly rpc: RpcResponder = (fn, args): FakeResult => {
    this.log.push(fn);
    const userId = args.p_user_id as string;
    const requestId = args.p_request_id as string;
    switch (fn) {
      case "reserve_ai_quota": {
        const kind = args.p_kind as "chat" | "scan";
        const limit = args.p_limit as number;
        if (!userId || !requestId || !["chat", "scan"].includes(kind) || !(limit > 0 && limit <= 100000)) {
          return { error: { code: "22023", message: "invalid quota parameters" } };
        }
        const existing = this.reservations.get(requestId);
        if (existing) {
          if (existing.userId !== userId) return { error: { code: "42501" } };
          if (existing.kind !== kind) return { error: { code: "22023" } };
          return { data: existing.status === "reserved" || existing.status === "committed" };
        }
        const b = this.bucket(userId);
        if (b[kind] >= limit) return { data: false };
        b[kind] += 1;
        this.reservations.set(requestId, { userId, kind, status: "reserved" });
        return { data: true };
      }
      case "release_ai_quota": {
        if (this.failRelease) return { error: { code: "XX000" } };
        const r = this.reservations.get(requestId);
        if (!r || r.userId !== userId || r.status !== "reserved") return { data: false };
        r.status = "released";
        this.bucket(userId)[r.kind as "chat" | "scan"] = Math.max(0, this.bucket(userId)[r.kind as "chat" | "scan"] - 1);
        return { data: true };
      }
      case "commit_ai_quota": {
        if (this.failCommit) return { error: { code: "XX000" } };
        const r = this.reservations.get(requestId);
        if (!r || r.userId !== userId) return { data: false };
        if (r.status === "reserved") r.status = "committed";
        return { data: r.status === "committed" };
      }
      default:
        return { error: { code: "PGRST202", message: "Could not find the function" } };
    }
  };
}
