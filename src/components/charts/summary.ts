import { formatShortDate } from "@/lib/format/date-vi";
import { formatExactVnd } from "./format";

/** Per-series figures, already computed by the finance engine and carried by the DTO. */
export interface SeriesStats {
  label: string;
  minimum: { date: string; value: number };
  end: { date: string; value: number };
  /** Days with balance < reserve (engine count). */
  breachDays: number;
  firstBreachDate: string | null;
}

export interface ChartSummaryInput {
  startDate: string;
  endDate: string;
  dayCount: number;
  reserve: number;
  series: readonly SeriesStats[];
}

/**
 * Plain-language description of the chart for assistive tech and for the visible caption.
 * Pure: it only formats numbers it is given (minimum, its date, end balance, breach count).
 */
export function buildChartSummary(input: ChartSummaryInput): string {
  const { startDate, endDate, dayCount, reserve, series } = input;
  const parts: string[] = [
    `Biểu đồ số dư ước tính ${dayCount} ngày, từ ${formatShortDate(startDate)} đến ${formatShortDate(endDate)}.`,
    reserve > 0 ? `Mức dự phòng tối thiểu là ${formatExactVnd(reserve)}.` : "Chưa đặt mức dự phòng tối thiểu.",
  ];
  for (const s of series) {
    const breach =
      s.breachDays > 0
        ? `${s.breachDays} ngày dưới mức dự phòng, ngày đầu tiên là ${s.firstBreachDate ? formatShortDate(s.firstBreachDate) : "không rõ"}`
        : "không có ngày nào dưới mức dự phòng";
    parts.push(
      `${s.label}: thấp nhất ${formatExactVnd(s.minimum.value)} vào ${formatShortDate(s.minimum.date)}, ` +
        `số dư cuối kỳ ${formatExactVnd(s.end.value)} vào ${formatShortDate(s.end.date)}, ${breach}.`,
    );
  }
  return parts.join(" ");
}
