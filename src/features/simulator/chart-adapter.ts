import type { ChartMarker, ChartSeries } from "@/components/charts/CashflowChart";
import { vndStringToNumber } from "@/components/charts/format";
import { buildChartSummary } from "@/components/charts/summary";
import type { ScenarioDto, SimulationDto } from "./types";

const NAMES = { now: "Mua ngay", later: "Mua sau" } as const;

export interface SimulatorChartData {
  series: ChartSeries[];
  reserve: number;
  markers: ChartMarker[];
  summary: string;
}

const toSeries = (s: ScenarioDto): ChartSeries => ({
  id: s.name,
  label: NAMES[s.name],
  variant: s.name === "now" ? "primary" : "secondary",
  points: s.series.map((p) => ({ date: p.date, value: vndStringToNumber(p.balanceVnd) })),
});

/** DTO -> chart props for the buy-now vs buy-later comparison (same dates, same baseline). */
export function simulationChartData(sim: SimulationDto): SimulatorChartData {
  const { now, later } = sim.scenarios;
  const reserve = vndStringToNumber(sim.reserveVnd);
  const markers: ChartMarker[] = (["now", "later"] as const).flatMap((name) => {
    const s = sim.scenarios[name];
    return [
      { seriesId: name, date: s.purchaseDate, kind: "purchase" as const, label: `${NAMES[name]} (ngày mua)` },
      { seriesId: name, date: s.minimumDate, kind: "minimum" as const, label: `Thấp nhất · ${NAMES[name].toLowerCase()}` },
    ];
  });
  return {
    series: [toSeries(now), toSeries(later)],
    reserve,
    markers,
    summary: buildChartSummary({
      startDate: sim.startDate,
      endDate: sim.endDate,
      dayCount: sim.horizonDays,
      reserve,
      series: [now, later].map((s) => ({
        label: NAMES[s.name],
        minimum: { date: s.minimumDate, value: vndStringToNumber(s.minimumVnd) },
        end: { date: sim.endDate, value: vndStringToNumber(s.endBalanceVnd) },
        breachDays: s.reserveBreachDays,
        firstBreachDate: s.firstBreachDate,
      })),
    }),
  };
}
