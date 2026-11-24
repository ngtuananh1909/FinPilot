import Link from "next/link";
import type { ReactNode } from "react";
import { CashflowChart } from "@/components/charts/CashflowChart";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "@/components/ui/classes";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Alert } from "@/lib/alerts";
import { describeAssumption } from "@/lib/finance-dto/assumptions";
import { formatDateTimeVi, formatFullDate, formatShortDate } from "@/lib/format/date-vi";
import { formatVndText } from "@/lib/format/vnd";
import { overviewChartData } from "./chart-adapter";
import { DEFAULT_QUESTION, SEVERITY_LABEL, assistantHref, questionForAlert } from "./insight";
import type { OverviewDto, OverviewIncompleteDto, OverviewReadyDto } from "./overview-types";
import { RetryButton } from "@/components/ui/RetryButton";

const FIELD_LABELS: Record<string, string> = {
  balance_snapshot: "số dư hiện tại",
  payday_day: "ngày nhận lương",
  expected_monthly_income: "thu nhập hằng tháng",
  expected_daily_expense: "chi tiêu ước tính mỗi ngày",
  recurring_items: "khoản định kỳ",
};

const ALERT_TONE = {
  critical: "border-error/40 bg-error-container text-on-error-container",
  warning: "border-warning/40 bg-warning-container text-on-warning-container",
  info: "border-secondary/30 bg-secondary-container text-on-secondary-container",
} as const;

const CARD = "rounded-card border border-outline-variant bg-surface-container-lowest p-4";

function Section({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={id} className="text-title-md text-on-surface">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "negative" }) {
  return (
    <div className={CARD}>
      <p className="text-label-md text-on-surface-variant">{label}</p>
      <p className={`mt-1 break-words text-title-lg tabular-nums ${tone === "negative" ? "text-error" : "text-on-surface"}`}>{value}</p>
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  return (
    <div className={`rounded-card border p-4 ${ALERT_TONE[alert.severity]}`}>
      <p className="text-label-md uppercase tracking-wide">{SEVERITY_LABEL[alert.severity]}</p>
      <h3 className="mt-1 text-title-md">{alert.title}</h3>
      <p className="mt-1 text-body-md">{alert.body}</p>
      <p className="mt-2 text-body-sm opacity-90">{alert.caveat}</p>
    </div>
  );
}

function InsightSlot({ overview }: { overview: OverviewReadyDto }) {
  const [top, ...rest] = overview.alerts;
  const question = top ? questionForAlert(top) : DEFAULT_QUESTION;
  return (
    <Section id="insight-heading" title="Gợi ý từ FinPilot">
      <div className="space-y-3">
        {top ? (
          <AlertCard alert={top} />
        ) : (
          <p className="text-body-md text-on-surface-variant">
            Chưa có cảnh báo nào theo các quy tắc hiện tại. Dự báo này vẫn chỉ là ước tính.
          </p>
        )}
        {rest.length > 0 ? (
          <ul className="space-y-2" aria-label="Các cảnh báo khác">
            {rest.map((alert) => (
              <li key={alert.code}>
                <AlertCard alert={alert} />
              </li>
            ))}
          </ul>
        ) : null}
        {overview.alertNotes.map((note) => (
          <p key={note.code} className="rounded-control bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">
            {note.message}
          </p>
        ))}
        <Link href={assistantHref(question)} className={BUTTON_SECONDARY}>
          Hỏi trợ lý AI về điều này
        </Link>
      </div>
    </Section>
  );
}

function CompletenessCard({ overview }: { overview: OverviewReadyDto }) {
  const { completeness } = overview;
  const missing = completeness.issues.map((i) => FIELD_LABELS[i.field] ?? i.field);
  return (
    <div className="rounded-card border border-outline-variant bg-surface-container-low p-4 text-body-md text-on-surface-variant">
      <p>
        Đây là số dư <strong className="text-on-surface">ước tính</strong> từ số dư bạn nhập và các giao dịch đã ghi. FinPilot không kết nối ngân
        hàng.
      </p>
      {missing.length > 0 ? (
        <p className="mt-2">
          Dự báo chưa đầy đủ: chưa thiết lập hoặc đang bằng 0 ({missing.join(", ")}).{" "}
          <Link href="/settings" className={`font-semibold text-primary underline ${FOCUS_RING}`}>
            Hoàn thiện trong Cài đặt
          </Link>
        </p>
      ) : null}
      {completeness.truncated ? <p className="mt-2">Một phần dữ liệu quá dài nên chưa được tải hết; kết quả có thể lệch.</p> : null}
      {overview.unreconciled.length > 0 ? (
        <p className="mt-2">
          Có {overview.unreconciled.length} khoản định kỳ đã đến hạn nhưng chưa khớp với giao dịch nào (ví dụ:{" "}
          {overview.unreconciled[0]!.label} ngày {formatShortDate(overview.unreconciled[0]!.date)}). FinPilot không tự đoán;{" "}
          <Link href="/transactions" className={`font-semibold text-primary underline ${FOCUS_RING}`}>
            kiểm tra trong Thu chi
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function ForecastFacts({ overview }: { overview: OverviewReadyDto }) {
  const s = overview.forecast.summary;
  const rows: Array<[string, string]> = [
    ["Thấp nhất", `${formatVndText(s.minimumVnd)} (${formatShortDate(s.minimumDate)})`],
    ["Cuối kỳ", `${formatVndText(s.endBalanceVnd)} (${formatShortDate(overview.forecast.endDate)})`],
    [
      "Dưới mức dự phòng",
      s.reserveBreachDays > 0
        ? `${s.reserveBreachDays} ngày, từ ${formatShortDate(s.firstBelowReserveDate ?? s.minimumDate)}`
        : "Không có ngày nào",
    ],
  ];
  return (
    <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-control bg-surface-container-low px-3 py-2">
          <dt className="text-label-md text-on-surface-variant">{label}</dt>
          <dd className="text-body-md tabular-nums text-on-surface">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReadyView({ overview }: { overview: OverviewReadyDto }) {
  const chart = overviewChartData(overview);
  const available = overview.availableAfterReserveVnd;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-headline-md text-on-surface">Tổng quan</h1>
      </header>

      <section aria-labelledby="balance-heading" className="rounded-card border border-outline-variant bg-surface-container-lowest p-5">
        <h2 id="balance-heading" className="text-label-md text-on-surface-variant">
          Số dư ước tính
        </h2>
        <p className="mt-1 break-words text-display-lg-mobile tabular-nums text-on-surface md:text-display-lg">
          {formatVndText(overview.currentBalance.amountVnd)}
        </p>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          ước tính tại <time dateTime={overview.asOf}>{formatDateTimeVi(overview.asOf)}</time>. Mốc số dư bạn nhập:{" "}
          {formatVndText(overview.currentBalance.snapshotVnd)} lúc {formatDateTimeVi(overview.currentBalance.snapshotAt)}.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={`Thu tháng này (từ ${formatFullDate(overview.month.start)})`} value={formatVndText(overview.month.incomeVnd)} />
        <Stat label="Chi tháng này" value={formatVndText(overview.month.expenseVnd)} />
        <Stat
          label={`Còn dùng được sau dự phòng ${formatVndText(overview.reserveVnd)}`}
          value={formatVndText(available)}
          {...(available.startsWith("-") ? { tone: "negative" as const } : {})}
        />
      </div>

      <CompletenessCard overview={overview} />
      <InsightSlot overview={overview} />

      <Section id="chart-heading" title={`Dự báo dòng tiền ${overview.forecast.horizonDays} ngày`}>
        <CashflowChart
          idPrefix="dashboard-cashflow"
          title={`Dự báo số dư ${overview.forecast.horizonDays} ngày tới`}
          summary={chart.summary}
          series={chart.series}
          reserve={chart.reserve}
          markers={chart.markers}
        />
        <ForecastFacts overview={overview} />
      </Section>

      <Section id="assumptions-heading" title="Giả định">
        <ul className="list-disc space-y-1 pl-5 text-body-md text-on-surface-variant">
          {overview.assumptions.map((a) => (
            <li key={a.code}>{describeAssumption(a)}</li>
          ))}
          <li>Khoản định kỳ và giao dịch đã lên lịch là khoản đã biết; chi tiêu hằng ngày là ước tính. Thu nhập có thể đến muộn hoặc khác dự kiến.</li>
        </ul>
      </Section>

      <Section id="upcoming-heading" title="Sắp tới">
        {overview.upcoming.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">Chưa có khoản định kỳ hay giao dịch lên lịch trong {overview.forecast.horizonDays} ngày tới.</p>
        ) : (
          <ul className="divide-y divide-outline-variant/60">
            {overview.upcoming.map((item, i) => (
              <li key={`${item.date}-${i}`} className="flex min-h-[44px] items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body-md text-on-surface">{item.label}</p>
                  <p className="text-body-sm text-on-surface-variant">
                    {formatShortDate(item.date)} · {item.daysFromToday === 0 ? "hôm nay" : `còn ${item.daysFromToday} ngày`}
                    {item.estimated ? " · ước tính" : ""}
                  </p>
                </div>
                <p className={`shrink-0 text-body-md font-semibold tabular-nums ${item.kind === "income" ? "text-success" : "text-on-surface"}`}>
                  <span className="sr-only">{item.kind === "income" ? "Thu " : "Chi "}</span>
                  {item.kind === "income" ? "+" : "-"}
                  {formatVndText(item.amountVnd)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="recent-heading"
        title="Giao dịch gần đây"
        action={
          <Link href="/transactions" className={`inline-flex min-h-[44px] items-center text-label-lg text-primary underline ${FOCUS_RING}`}>
            Xem tất cả
          </Link>
        }
      >
        {overview.recentTransactions.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">Chưa có giao dịch nào. Hãy thêm giao dịch đầu tiên để dự báo sát thực tế hơn.</p>
        ) : (
          <ul className="divide-y divide-outline-variant/60">
            {overview.recentTransactions.map((t) => (
              <li key={t.id} className="flex min-h-[44px] items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body-md text-on-surface">{t.merchant ?? t.description ?? t.category}</p>
                  <p className="text-body-sm text-on-surface-variant">{formatShortDate(t.localDate)}</p>
                </div>
                <p
                  className={`shrink-0 text-body-md font-semibold tabular-nums ${
                    t.kind === "income" ? "text-success" : t.kind === "excluded" ? "text-on-surface-variant" : "text-on-surface"
                  }`}
                >
                  <span className="sr-only">{t.kind === "income" ? "Thu " : t.kind === "expense" ? "Chi " : "Không tính "}</span>
                  {t.kind === "income" ? "+" : t.kind === "expense" ? "-" : ""}
                  {formatVndText(t.amountVnd)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

const EMPTY_ACTIONS: Record<OverviewIncompleteDto["reason"], ReactNode> = {
  profile_missing: (
    <Link href="/onboarding" className={BUTTON_PRIMARY}>
      Hoàn thiện hồ sơ
    </Link>
  ),
  profile_empty: (
    <div className="flex flex-wrap justify-center gap-2">
      <Link href="/settings" className={BUTTON_PRIMARY}>
        Nhập số dư trong Cài đặt
      </Link>
      <Link href="/transactions" className={BUTTON_SECONDARY}>
        Thêm giao dịch
      </Link>
    </div>
  ),
  balance_unreliable: (
    <Link href="/settings" className={BUTTON_PRIMARY}>
      Cập nhật số dư mới trong Cài đặt
    </Link>
  ),
};

export function DashboardEmpty({ overview }: { overview: OverviewIncompleteDto }) {
  return (
    <div className="space-y-4">
      <h1 className="text-headline-md text-on-surface">Tổng quan</h1>
      <EmptyState title="Chưa thể hiển thị số dư" description={overview.message} action={EMPTY_ACTIONS[overview.reason]} />
    </div>
  );
}

export function DashboardError({ message, code }: { message: string; code?: string | undefined }) {
  return (
    <div className="space-y-4">
      <h1 className="text-headline-md text-on-surface">Tổng quan</h1>
      <div role="alert" className="rounded-card border border-error/40 bg-surface-container-lowest p-6 text-center">
        <h2 className="text-title-lg text-error">Không tải được tổng quan</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">{message}</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">FinPilot không hiển thị số dư khi chưa tính được.</p>
        {code ? <p className="mt-1 text-body-sm text-outline">Mã lỗi: {code}</p> : null}
        <div className="mt-4 flex justify-center">
          <RetryButton />
        </div>
      </div>
    </div>
  );
}

export type DashboardState = { kind: "overview"; overview: OverviewDto } | { kind: "error"; message: string; code?: string | undefined };

export function DashboardContent({ state }: { state: DashboardState }) {
  if (state.kind === "error") return <DashboardError message={state.message} code={state.code} />;
  return state.overview.state === "ready" ? <ReadyView overview={state.overview} /> : <DashboardEmpty overview={state.overview} />;
}
