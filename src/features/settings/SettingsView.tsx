"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { FormAlert } from "@/components/ui/FormAlert";
import { Skeleton } from "@/components/ui/Skeleton";
import { listRecurringApi } from "@/features/transactions/api";
import { browserFetch, type FetchLike } from "@/lib/http/api-call";
import type { GoalDto } from "@/lib/settings/dto";
import type { BalanceSnapshotResult, ProfileWriteResult, SettingsDocument } from "@/lib/settings/service";
import type { RecurringSuggestionDto } from "@/lib/transactions/dto";
import { getSettingsApi } from "./api";
import { AccountCard } from "./AccountCard";
import { BalanceCard } from "./BalanceCard";
import { GoalCard } from "./GoalCard";
import { ProfileCard } from "./ProfileCard";
import { ReadinessBanner } from "./ReadinessBanner";
import { RecurringCard } from "./RecurringCard";
export interface SuggestionState {
  items: RecurringSuggestionDto[];
  incomplete: boolean;
}
const NO_SUGGESTIONS: SuggestionState = { items: [], incomplete: false };
export function SettingsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Đang tải Cài đặt…</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  );
}
/** Pure body of the page once data is loaded. Handlers are supplied by `SettingsView`. */
export function SettingsContent({
  doc,
  suggestions,
  isGuest,
  fetchImpl,
  onProfileSaved,
  onBalanceChanged,
  onRecurringChanged,
  onGoalChanged,
  onReset,
}: {
  doc: SettingsDocument;
  suggestions: SuggestionState;
  isGuest: boolean;
  fetchImpl?: FetchLike;
  onProfileSaved: (result: ProfileWriteResult) => void;
  onBalanceChanged: (result: BalanceSnapshotResult) => void;
  onRecurringChanged: (message: string) => void;
  onGoalChanged: (goal: GoalDto | null, message: string) => void;
  onReset: (message: string) => void;
}) {
  const shared = fetchImpl ? { fetchImpl } : {};
  return (
    <div className="space-y-4">
      <ReadinessBanner readiness={doc.forecastReadiness} />
      <ProfileCard key={doc.profile.updatedAt} profile={doc.profile} onSaved={onProfileSaved} {...shared} />
      <BalanceCard profile={doc.profile} onChanged={onBalanceChanged} {...shared} />
      <RecurringCard
        items={doc.recurringItems}
        truncated={doc.recurringTruncated}
        suggestions={suggestions.items}
        suggestionsIncomplete={suggestions.incomplete}
        onChanged={onRecurringChanged}
        {...shared}
      />
      <GoalCard goal={doc.goal} onChanged={onGoalChanged} {...shared} />
      <AccountCard profile={doc.profile} isGuest={isGuest} onReset={onReset} {...shared} />
    </div>
  );
}
type Status = "loading" | "error" | "ready";
export function SettingsView({ isGuest, fetchImpl = browserFetch }: { isGuest: boolean; fetchImpl?: FetchLike }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SettingsDocument | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionState>(NO_SUGGESTIONS);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setStatus("loading");
      const [settings, recurring] = await Promise.all([getSettingsApi(fetchImpl), listRecurringApi(fetchImpl)]);
      if (!settings.ok) {
        setError(settings.message);
        setStatus("error");
        return;
      }
      setDoc(settings.data);
      // Suggestions are optional: a failure there must not hide the settings themselves.
      setSuggestions(
        recurring.ok && recurring.data.suggestionsAvailable
          ? { items: recurring.data.unreconciledSuggestions, incomplete: recurring.data.suggestionsMayBeIncomplete }
          : NO_SUGGESTIONS,
      );
      setStatus("ready");
    },
    [fetchImpl],
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  const merge = (patch: (current: SettingsDocument) => SettingsDocument) =>
    setDoc((current) => (current ? patch(current) : current));
  if (status === "loading") return <PageFrame><SettingsSkeleton /></PageFrame>;
  if (status === "error" || !doc) {
    return (
      <PageFrame>
        <ErrorState title="Không tải được Cài đặt" message={error ?? "Vui lòng thử lại."} onRetry={() => void load(false)} />
      </PageFrame>
    );
  }
  return (
    <PageFrame>
      <FormAlert message={notice} tone="info" />
      <SettingsContent
        doc={doc}
        suggestions={suggestions}
        isGuest={isGuest}
        fetchImpl={fetchImpl}
        onProfileSaved={(result) => {
          merge((c) => ({ ...c, profile: result.profile, forecastReadiness: result.forecastReadiness }));
          setNotice("Đã lưu hồ sơ. Dự báo sẽ dùng các giá trị mới.");
        }}
        onBalanceChanged={(result) => {
          merge((c) => ({ ...c, profile: result.profile, forecastReadiness: result.forecastReadiness }));
          setNotice("Đã cập nhật số dư hiện tại. Dự báo sẽ dùng mốc mới.");
        }}
        onRecurringChanged={(message) => {
          setNotice(message);
          void load(true);
        }}
        onGoalChanged={(goal, message) => {
          merge((c) => ({ ...c, goal }));
          setNotice(message);
        }}
        onReset={(message) => {
          setNotice(message);
          void load(false);
        }}
      />
    </PageFrame>
  );
}
function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-headline-md text-on-surface">Cài đặt</h1>
      {children}
    </div>
  );
}
