import Link from "next/link";
import { CashflowChart } from "@/components/charts/CashflowChart";
import { BUTTON_SECONDARY } from "@/components/ui/classes";
import { assistantHref } from "@/features/dashboard/insight";
import { describeAssumption } from "@/lib/finance-dto/assumptions";
import { formatShortDate } from "@/lib/format/date-vi";
import { formatVndText } from "@/lib/format/vnd";
import { simulationChartData } from "./chart-adapter";
import type { ScenarioDto, SimulationDto } from "./types";

const TITLES = { now: "Mua ngay", later: "Mua sau" } as const;

const BADGES: Record<ScenarioDto["violation"], { text: string; icon: string; tone: string }> = {
  none: { text: "Giữ ≥ mức dự phòng", icon: "✓", tone: "bg-success-container text-on-success-container" },
  below_reserve: { text: "Dưới mức dự phòng", icon: "▲", tone: "bg-warning-container text-on-warning-container" },
  below_zero: { text: "Xuống dưới 0 ₫", icon: "✕", tone: "bg-error-container text-on-error-container" },
};

function ScenarioCard({ scenario, reserve }: { scenario: ScenarioDto; reserve: string }) {
  const badge = BADGES[scenario.violation];
  const rows: Array<[string, string]> = [
    ["Thấp nhất", `${formatVndText(scenario.minimumVnd)} (${formatShortDate(scenario.minimumDate)})`],
    ["Cuối kỳ", formatVndText(scenario.endBalanceVnd)],
    [
      "Ngày dưới mức dự phòng",
      scenario.reserveBreachDays > 0
        ? `${scenario.reserveBreachDays} ngày, từ ${formatShortDate(scenario.firstBreachDate ?? scenario.minimumDate)}`
        : "0 ngày",
    ],
    [
      "Chênh so với mức dự phòng",
      `${scenario.reserveHeadroomVnd.startsWith("-") ? "" : "+"}${formatVndText(scenario.reserveHeadroomVnd)}`,
    ],
  ];
  return (
    <article
      aria-labelledby={`scenario-${scenario.name}`}
      className="rounded-card border border-outline-variant bg-surface-container-lowest p-4"
      data-scenario={scenario.name}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`scenario-${scenario.name}`} className="text-title-md text-on-surface">
          {TITLES[scenario.name]} · {formatShortDate(scenario.purchaseDate)}
        </h3>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-label-md ${badge.tone}`}>
          <span aria-hidden="true">{badge.icon}</span>
          {badge.text}
        </span>
      </div>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-body-sm text-on-surface-variant">{label}</dt>
            <dd className="break-words text-right text-body-md tabular-nums text-on-surface">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-body-sm text-on-surface-variant">So với mức dự phòng {formatVndText(reserve)}.</p>
    </article>
  );
}

export function SimulationResult({ result }: { result: SimulationDto }) {
  const chart = simulationChartData(result);
  const subject = result.itemName ?? "khoản mua này";
  const question =
    `Giúp tôi so sánh việc mua ${subject} (${formatVndText(result.costVnd)}) vào ${formatShortDate(result.scenarios.now.purchaseDate)} ` +
    `với mua vào ${formatShortDate(result.scenarios.later.purchaseDate)}, và giải thích vì sao.`;
  const [intro, ...rest] = result.conclusions;
  return (
    <div className="space-y-4" data-testid="simulation-result">
      <section aria-labelledby="conclusion-heading" className="rounded-card border border-outline-variant bg-surface-container-lowest p-4">
        <h2 id="conclusion-heading" className="text-title-md text-on-surface">
          Kết quả mô phỏng
        </h2>
        {result.bothUnsafe ? (
          <p role="status" className="mt-2 rounded-control bg-warning-container px-3 py-2 text-body-md text-on-warning-container">
            Cả hai cách mua đều chưa giữ được mức dự phòng theo ước tính.
          </p>
        ) : null}
        {intro ? <p className="mt-2 text-body-md text-on-surface">{intro}</p> : null}
        <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-on-surface-variant">
          {rest.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ScenarioCard scenario={result.scenarios.now} reserve={result.reserveVnd} />
        <ScenarioCard scenario={result.scenarios.later} reserve={result.reserveVnd} />
      </div>

      <section aria-labelledby="sim-chart-heading" className="rounded-card border border-outline-variant bg-surface-container-lowest p-4">
        <h2 id="sim-chart-heading" className="mb-3 text-title-md text-on-surface">
          So sánh số dư {result.horizonDays} ngày
        </h2>
        <CashflowChart
          idPrefix="simulator-cashflow"
          title={`So sánh số dư ${result.horizonDays} ngày: mua ngay và mua sau`}
          summary={chart.summary}
          series={chart.series}
          reserve={chart.reserve}
          markers={chart.markers}
        />
      </section>

      <section aria-labelledby="sim-assumptions-heading" className="rounded-card border border-outline-variant bg-surface-container-lowest p-4">
        <h2 id="sim-assumptions-heading" className="text-title-md text-on-surface">
          Giả định
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-on-surface-variant">
          <li>Cả hai kịch bản dùng cùng một dự báo nền {result.horizonDays} ngày (từ {formatShortDate(result.startDate)} đến {formatShortDate(result.endDate)}); khoản mua chỉ được trừ một lần vào ngày mua.</li>
          <li>Số dư hiện tại ước tính: {formatVndText(result.currentBalanceVnd)}.</li>
          {result.assumptions.map((a) => (
            <li key={a.code}>{describeAssumption(a)}</li>
          ))}
          {!result.readiness.complete ? (
            <li>
              Hồ sơ tài chính chưa đầy đủ, nên kết quả kém tin cậy hơn.{" "}
              <Link href="/settings" className="font-semibold text-primary underline">
                Hoàn thiện trong Cài đặt
              </Link>
            </li>
          ) : null}
        </ul>
        <p className="mt-3 rounded-control bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">{result.caveat}</p>
      </section>

      <Link href={assistantHref(question)} className={BUTTON_SECONDARY}>
        Hỏi trợ lý AI để hiểu rõ hơn
      </Link>
    </div>
  );
}
