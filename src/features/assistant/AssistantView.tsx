"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import { FormAlert } from "@/components/ui/FormAlert";
import { RichText } from "./RichText";
import { browserFetch, callApi, type FetchLike } from "@/lib/http/api-call";
import {
  PROPOSAL_STATUS_LABEL,
  SUGGESTED_PROMPTS,
  TOOL_LABELS,
  formatChangeValue,
  summarizeEvidence,
  type ProposalView,
  type QuotaView,
  type ToolEvidence,
} from "./evidence";

const MAX_CHARS = 2000;

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolEvidence[];
  proposals: ProposalView[];
}

interface ChatResponse {
  conversationId: string;
  status: string;
  answer: string;
  toolCalls: ToolEvidence[];
  proposals: ProposalView[];
  quota: QuotaView;
}

export interface AssistantViewProps {
  aiConfigured: boolean;
  initialQuota: QuotaView | null;
  /** Sanitised `?q=` prefill: placed in the composer, never auto-sent. */
  prefill: string;
  fetchImpl?: FetchLike;
}

function EvidenceList({ calls }: { calls: ToolEvidence[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="mt-3 rounded-control border border-outline-variant bg-surface-container-low">
      <summary className={`flex min-h-[44px] cursor-pointer items-center px-3 text-label-lg text-secondary ${FOCUS_RING}`}>
        Dữ liệu đã tra cứu ({calls.length})
      </summary>
      <ul className="space-y-2 px-3 pb-3">
        {calls.map((c, i) => (
          <li key={`${c.name}-${i}`} className="rounded-control bg-surface-container-lowest p-2 text-body-sm">
            <p className="font-semibold text-on-surface">
              <span aria-hidden="true">{c.ok ? "✓ " : "✕ "}</span>
              {TOOL_LABELS[c.name] ?? c.name}
              {c.cached ? <span className="ml-1 text-on-surface-variant">(dùng lại kết quả)</span> : null}
            </p>
            <p className="text-on-surface-variant">{summarizeEvidence(c)}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProposalCard({
  proposal,
  onDecide,
  busy,
}: {
  proposal: ProposalView;
  onDecide: (id: string, action: "approve" | "reject") => void;
  busy: boolean;
}) {
  const tone = proposal.status === "approved" ? "success" : proposal.status === "pending" ? "primary" : "neutral";
  return (
    <section aria-label="Đề xuất thay đổi" className="mt-3 rounded-card border border-primary/40 bg-primary-container/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-title-md text-on-surface">{proposal.kind === "budget_update" ? "Đề xuất ngân sách tháng" : "Đề xuất mục tiêu tiết kiệm"}</h3>
        <Badge tone={tone}>{PROPOSAL_STATUS_LABEL[proposal.status]}</Badge>
      </div>
      <dl className="mt-2 space-y-1 text-body-md">
        {proposal.changes.map((c) => (
          <div key={c.field} className="flex flex-wrap gap-x-2">
            <dt className="text-on-surface-variant">{c.label}:</dt>
            <dd className="tabular-nums">
              {formatChangeValue(c.field, c.from)} <span aria-hidden="true">→</span>
              <span className="sr-only"> thành </span> <strong>{formatChangeValue(c.field, c.to)}</strong>
            </dd>
          </div>
        ))}
      </dl>
      {proposal.reason ? <p className="mt-2 text-body-sm text-on-surface-variant">Lý do: {proposal.reason}</p> : null}
      {proposal.status === "pending" ? (
        <>
          <p className="mt-2 text-body-sm text-on-surface-variant">Chưa có gì thay đổi cho đến khi bạn bấm Xác nhận.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={() => onDecide(proposal.id, "approve")}>
              Xác nhận
            </button>
            <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => onDecide(proposal.id, "reject")}>
              Hủy
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function AssistantView({ aiConfigured, initialQuota, prefill, fetchImpl = browserFetch }: AssistantViewProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState(prefill);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaView | null>(initialQuota);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const sending = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const counterId = useId();

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length]);

  const exhausted = quota !== null && quota.remaining <= 0;
  const disabled = !aiConfigured || exhausted || pending;

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending.current || !aiConfigured) return;
    sending.current = true;
    setPending(true);
    setError(null);
    setLastFailed(null);
    const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", content: message, toolCalls: [], proposals: [] };
    setTurns((t) => [...t, userTurn]);
    setDraft("");
    const result = await callApi<ChatResponse>(fetchImpl, "POST", "/api/assistant/chat", {
      message,
      ...(conversationId ? { conversationId } : {}),
    });
    if (result.ok) {
      const d = result.data;
      setConversationId(d.conversationId);
      setQuota(d.quota);
      setTurns((t) => [...t, { id: `a-${Date.now()}`, role: "assistant", content: d.answer, toolCalls: d.toolCalls ?? [], proposals: d.proposals ?? [] }]);
    } else {
      setTurns((t) => t.filter((x) => x.id !== userTurn.id));
      setDraft(message);
      setLastFailed(result.code === "rate_limited" || result.code === "ai_not_configured" ? null : message);
      if (result.code === "rate_limited" && quota) setQuota({ ...quota, remaining: 0, used: quota.limit });
      setError(result.message);
    }
    setPending(false);
    sending.current = false;
  }

  async function decide(id: string, action: "approve" | "reject") {
    if (decisionBusy) return;
    setDecisionBusy(id);
    setDecisionError(null);
    const r = await callApi<{ proposal: ProposalView }>(fetchImpl, "POST", `/api/assistant/proposals/${encodeURIComponent(id)}/${action}`, { confirm: true });
    if (r.ok) {
      setTurns((t) => t.map((turn) => ({ ...turn, proposals: turn.proposals.map((p) => (p.id === id ? r.data.proposal : p)) })));
    } else {
      setDecisionError(r.message);
      if (r.status === 409) {
        const status = r.reason === "proposal_rejected" ? "rejected" : r.reason === "proposal_approved" ? "approved" : "expired";
        setTurns((t) => t.map((turn) => ({ ...turn, proposals: turn.proposals.map((p) => (p.id === id ? { ...p, status } : p)) })));
      }
    }
    setDecisionBusy(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-40 md:pb-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-headline-md text-on-surface">Trợ lý AI</h1>
          <p className="text-body-md text-on-surface-variant">Hỏi về dòng tiền của bạn. Số liệu lấy từ dữ liệu của bạn qua công cụ tính toán, không phải lời khuyên tài chính.</p>
        </div>
        {quota ? (
          <p className="text-body-sm text-on-surface-variant" aria-live="polite">
            Còn <strong className="tabular-nums">{quota.remaining}</strong>/{quota.limit} lượt hôm nay
          </p>
        ) : null}
      </header>

      {!aiConfigured ? (
        <div role="status" className="rounded-card border border-warning/40 bg-warning-container p-4 text-body-md text-on-warning-container">
          <p className="font-semibold">Trợ lý AI chưa được cấu hình.</p>
          <p>Quản trị viên chưa thiết lập nhà cung cấp AI nên chưa thể trò chuyện. FinPilot không tạo câu trả lời giả. Bạn vẫn dùng được Tổng quan, Thu chi và Mô phỏng.</p>
          <Link href="/simulator" className="mt-2 inline-block text-secondary underline">Mở Mô phỏng</Link>
        </div>
      ) : null}

      {exhausted ? (
        <div role="status" className="rounded-card border border-outline-variant bg-surface-container-low p-4 text-body-md">
          Bạn đã dùng hết lượt trò chuyện hôm nay. Lượt mới có từ 0 giờ (giờ Việt Nam).
        </div>
      ) : null}

      <ol className="flex flex-col gap-3" aria-label="Cuộc trò chuyện" aria-live="polite">
        {turns.length === 0 ? (
          <li className="rounded-card border border-outline-variant bg-surface-container-lowest p-4">
            <p className="text-title-md text-on-surface">Gợi ý câu hỏi</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((p) => (
                <li key={p}>
                  <button type="button" className={`${BUTTON_SECONDARY} text-left`} disabled={disabled} onClick={() => void send(p)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ) : null}
        {turns.map((t) => (
          <li
            key={t.id}
            className={
              t.role === "user"
                ? "ml-auto max-w-[85%] rounded-card bg-primary px-4 py-3 text-body-md text-on-primary"
                : "mr-auto w-full max-w-[95%] rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-3 text-body-md text-on-surface"
            }
          >
            <span className="sr-only">{t.role === "user" ? "Bạn: " : "FinPilot: "}</span>
            {t.role === "assistant" ? <RichText text={t.content} /> : <p className="whitespace-pre-wrap break-words">{t.content}</p>}
            {t.role === "assistant" ? <EvidenceList calls={t.toolCalls} /> : null}
            {t.proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} onDecide={(id, a) => void decide(id, a)} busy={decisionBusy !== null} />
            ))}
          </li>
        ))}
        {pending ? (
          <li className="mr-auto rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-3 text-body-md text-on-surface-variant" role="status">
            FinPilot đang tra cứu dữ liệu…
          </li>
        ) : null}
      </ol>
      <div ref={endRef} />

      <FormAlert message={decisionError} />
      {error ? (
        <div className="flex flex-col gap-2">
          <FormAlert message={error} />
          {lastFailed ? (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void send(lastFailed)} disabled={disabled}>
              Thử lại
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-[64px] z-20 border-t border-outline-variant bg-surface/95 p-3 md:static md:border-0 md:bg-transparent md:p-0"
        aria-label="Gửi câu hỏi"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            Câu hỏi cho trợ lý
          </label>
          <textarea
            id={inputId}
            value={draft}
            maxLength={MAX_CHARS}
            rows={2}
            aria-describedby={counterId}
            disabled={!aiConfigured || exhausted}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={aiConfigured ? "Ví dụ: Tôi có đủ tiền đóng trọ không?" : "Trợ lý AI chưa được cấu hình"}
            className={`min-h-[44px] w-full resize-none rounded-control border border-outline bg-surface-container-lowest px-4 py-2 text-body-lg ${FOCUS_RING}`}
          />
          <button type="submit" className={BUTTON_PRIMARY} disabled={disabled || draft.trim().length === 0}>
            {pending ? "Đang gửi…" : "Gửi"}
          </button>
        </div>
        <p id={counterId} className="mx-auto mt-1 max-w-3xl text-body-sm text-on-surface-variant">
          {draft.length}/{MAX_CHARS} ký tự. Câu trả lời là ước tính, hãy kiểm tra trước khi quyết định.
        </p>
      </form>
    </div>
  );
}
