import type { ChartMarker, ChartSeries } from "@/components/charts/CashflowChart";
import { formatCompactVnd, vndStringToNumber } from "@/components/charts/format";
import { buildChartSummary } from "@/components/charts/summary";
import type { OverviewReadyDto } from "./overview-types";

export interface DashboardChartData {
  series: ChartSeries[];
  reserve: number;
  markers: ChartMarker[];
  summary: string;
}

/**
 * DTO -> chart props. Strings become numbers here, for pixels and labels only; every figure in the
 * summary (minimum, breach days, end balance) comes straight from the engine's summary in the DTO.
 */
export function overviewChartData(overview: OverviewReadyDto): DashboardChartData {
  const { forecast } = overview;
  const reserve = vndStringToNumber(overview.reserveVnd);
  const points = forecast.days.map((d) => ({ date: d.date, value: vndStringToNumber(d.closingBalanceVnd) }));
  const markers: ChartMarker[] = [
    { seriesId: "balance", date: forecast.summary.minimumDate, kind: "minimum", label: "Thấp nhất" },
    ...overview.upcoming.map((item): ChartMarker => ({
      seriesId: "balance",
      date: item.date,
      kind: item.kind,
      label: `${item.label} ${item.kind === "income" ? "+" : "-"}${formatCompactVnd(vndStringToNumber(item.amountVnd))}`,
    })),
  ];
  return {
    series: [{ id: "balance", label: "Số dư dự kiến", points, variant: "primary" }],
    reserve,
    markers,
    summary: buildChartSummary({
      startDate: forecast.startDate,
      endDate: forecast.endDate,
      dayCount: forecast.horizonDays,
      reserve,
      series: [
        {
          label: "Số dư dự kiến",
          minimum: { date: forecast.summary.minimumDate, value: vndStringToNumber(forecast.summary.minimumVnd) },
          end: { date: forecast.endDate, value: vndStringToNumber(forecast.summary.endBalanceVnd) },
          breachDays: forecast.summary.reserveBreachDays,
          firstBreachDate: forecast.summary.firstBelowReserveDate,
        },
      ],
    }),
  };
}
