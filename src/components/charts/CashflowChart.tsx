import { formatShortDate } from "@/lib/format/date-vi";
import { formatCompactVnd, formatExactVnd } from "./format";
import {
  belowThresholdPolygons,
  computeYDomain,
  linearScale,
  linePath,
  maxLabelsFor,
  niceTicks,
  polygonPath,
  selectTickIndices,
} from "./geometry";

export interface ChartPoint {
  /** YYYY-MM-DD */
  date: string;
  /** VND, prepared by the DTO adapter. Used for pixels and labels only. */
  value: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  points: readonly ChartPoint[];
  /** primary = solid indigo line; secondary = dashed blue line (second scenario). */
  variant: "primary" | "secondary";
}

export interface ChartMarker {
  seriesId: string;
  date: string;
  kind: "minimum" | "income" | "expense" | "purchase";
  /** Short text shown in tooltips and in the data table. */
  label: string;
}

export interface CashflowChartProps {
  /** Unique per page: prefixes every id in the SVG. */
  idPrefix: string;
  title: string;
  /** Plain-language summary (see buildChartSummary). Shown below the chart and used as its accessible description. */
  summary: string;
  series: readonly ChartSeries[];
  /** Effective reserve in VND; <= 0 hides the reserve line. */
  reserve: number;
  markers?: readonly ChartMarker[];
}

const WIDTH = 360;
const HEIGHT = 224;
const MARGIN = { top: 14, right: 14, bottom: 26, left: 46 } as const;
const INNER_W = WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;
/** ~52px per "24/11" label keeps them apart on a 375px screen. */
const MAX_X_LABELS = maxLabelsFor(INNER_W, 56);
const HALO = { paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round" } as const;

const SERIES_CLASS: Record<ChartSeries["variant"], { stroke: string; dash: string | undefined }> = {
  primary: { stroke: "text-primary", dash: undefined },
  secondary: { stroke: "text-secondary", dash: "7 3" },
};

/**
 * Hand-written responsive SVG line chart (no chart library). It draws numbers it is given and
 * performs no financial calculation. Static: no animation, so nothing to reduce for
 * prefers-reduced-motion. Color is never the only signal: the reserve line is dashed + labelled,
 * the below-reserve area is hatched, markers differ by shape, and a data table repeats every value.
 */
export function CashflowChart({ idPrefix, title, summary, series, reserve, markers = [] }: CashflowChartProps) {
  const axis = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const dateIndex = new Map(axis.map((d, i) => [d, i]));
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const showReserve = reserve > 0;
  const [yMin, yMax] = computeYDomain([...allValues, 0, ...(showReserve ? [reserve] : [])], 0.12);
  const yScale = linearScale([yMin, yMax], [MARGIN.top + INNER_H, MARGIN.top]);
  const xAt = (index: number): number =>
    axis.length <= 1 ? MARGIN.left + INNER_W / 2 : MARGIN.left + (index / (axis.length - 1)) * INNER_W;
  const pixel = (p: ChartPoint) => ({ x: xAt(dateIndex.get(p.date) ?? 0), y: yScale(p.value) });
  const yTicks = niceTicks(yMin, yMax, 4);
  const xTickIndices = selectTickIndices(axis.length, MAX_X_LABELS);
  const ids = {
    title: `${idPrefix}-title`,
    summary: `${idPrefix}-summary`,
    hatch: `${idPrefix}-hatch`,
  };
  const valueOn = (seriesId: string, date: string): number | undefined =>
    series.find((s) => s.id === seriesId)?.points.find((p) => p.date === date)?.value;
  const zeroY = yScale(0);
  const reserveY = yScale(reserve);

  return (
    <figure className="m-0">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-on-surface-variant" aria-label="Chú giải biểu đồ">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="24" height="8" viewBox="0 0 24 8" className={SERIES_CLASS[s.variant].stroke}>
              <line x1="0" y1="4" x2="24" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray={SERIES_CLASS[s.variant].dash} />
            </svg>
            {s.label}
          </li>
        ))}
        {showReserve ? (
          <li className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="24" height="8" viewBox="0 0 24 8" className="text-warning">
              <line x1="0" y1="4" x2="24" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="2 3" />
            </svg>
            Mức dự phòng
          </li>
        ) : null}
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="text-error">
            <rect width="12" height="12" fill="#ffdad6" />
            <line x1="0" y1="12" x2="12" y2="0" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Dưới mức dự phòng
        </li>
      </ul>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`${ids.title} ${ids.summary}`}
        className="block h-auto w-full max-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={ids.title}>{title}</title>
        <defs>
          <pattern id={ids.hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#ffdad6" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#ba1a1a" strokeWidth="1.6" />
          </pattern>
        </defs>

        {/* grid + y labels */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} stroke="#c7c4d8" strokeWidth="0.5" />
            <text x={MARGIN.left - 6} y={yScale(tick) + 3.5} textAnchor="end" fontSize="10" fill="#464555">
              {formatCompactVnd(tick)}
            </text>
          </g>
        ))}

        {/* x labels (thin ticks) */}
        {xTickIndices.map((index) => {
          const date = axis[index]!;
          const x = xAt(index);
          return (
            <g key={date}>
              <line x1={x} x2={x} y1={MARGIN.top + INNER_H} y2={MARGIN.top + INNER_H + 3} stroke="#777587" strokeWidth="0.75" />
              <text
                x={x}
                y={HEIGHT - 8}
                textAnchor={index === 0 && axis.length > 1 ? "start" : index === axis.length - 1 && axis.length > 1 ? "end" : "middle"}
                fontSize="10"
                fill="#464555"
              >
                {formatShortDate(date)}
              </text>
            </g>
          );
        })}

        {/* shading below the reserve (hatched) */}
        {showReserve
          ? series.map((s) =>
              belowThresholdPolygons(
                s.points.map((p) => ({ x: pixel(p).x, value: p.value })),
                reserve,
              ).map((polygon, i) => (
                <path
                  key={`${s.id}-${i}`}
                  d={polygonPath(polygon.map((p) => ({ x: p.x, y: yScale(p.value) })))}
                  fill={`url(#${ids.hatch})`}
                  fillOpacity="0.7"
                  data-testid="below-reserve-area"
                />
              )),
            )
          : null}

        {/* zero line and reserve line, both labelled */}
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={zeroY} y2={zeroY} stroke="#1b1b24" strokeWidth="1" />
        <text x={WIDTH - MARGIN.right - 2} y={zeroY + 11} textAnchor="end" fontSize="10" fill="#1b1b24" style={HALO}>
          0 ₫
        </text>
        {showReserve ? (
          <>
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={reserveY} y2={reserveY} stroke="#b45309" strokeWidth="1.5" strokeDasharray="2 3" />
            <text x={WIDTH - MARGIN.right - 2} y={reserveY - 4} textAnchor="end" fontSize="10" fill="#78350f" style={HALO}>
              Dự phòng {formatCompactVnd(reserve)}
            </text>
          </>
        ) : null}

        {/* series lines */}
        {series.map((s) => (
          <path
            key={s.id}
            d={linePath(s.points.map(pixel))}
            fill="none"
            stroke="currentColor"
            className={SERIES_CLASS[s.variant].stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={SERIES_CLASS[s.variant].dash}
          />
        ))}
        {/* a lone point has no line to draw */}
        {series.map((s) =>
          s.points.length === 1 ? (
            <circle key={`${s.id}-dot`} cx={pixel(s.points[0]!).x} cy={pixel(s.points[0]!).y} r="3" fill="currentColor" className={SERIES_CLASS[s.variant].stroke} />
          ) : null,
        )}

        {/* markers: shape encodes the kind */}
        {markers.map((marker, i) => {
          const value = valueOn(marker.seriesId, marker.date);
          const index = dateIndex.get(marker.date);
          if (value === undefined || index === undefined) return null;
          const x = xAt(index);
          const y = yScale(value);
          const detail = `${marker.label} · ${formatShortDate(marker.date)} · ${formatExactVnd(value)}`;
          if (marker.kind === "minimum") {
            const placeBelow = y + 20 < MARGIN.top + INNER_H;
            return (
              <g key={`m-${i}`} data-marker="minimum">
                <title>{detail}</title>
                <circle cx={x} cy={y} r="5" fill="#ffffff" stroke="#ba1a1a" strokeWidth="2" />
                <text
                  x={x}
                  y={placeBelow ? y + 17 : y - 10}
                  textAnchor={x > WIDTH - 70 ? "end" : x < MARGIN.left + 40 ? "start" : "middle"}
                  fontSize="10"
                  fontWeight="600"
                  fill="#93000a"
                  style={HALO}
                >
                  {marker.label}
                </text>
              </g>
            );
          }
          const shape =
            marker.kind === "income"
              ? `${x - 4.5},${y + 4} ${x + 4.5},${y + 4} ${x},${y - 5}`
              : marker.kind === "expense"
                ? `${x - 4.5},${y - 4} ${x + 4.5},${y - 4} ${x},${y + 5}`
                : `${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`;
          const fill = marker.kind === "income" ? "#15803d" : marker.kind === "expense" ? "#464555" : "#ffffff";
          return (
            <g key={`m-${i}`} data-marker={marker.kind}>
              <title>{detail}</title>
              <polygon points={shape} fill={fill} stroke={marker.kind === "purchase" ? "#1b1b24" : "#ffffff"} strokeWidth={marker.kind === "purchase" ? 2 : 1} />
            </g>
          );
        })}
      </svg>

      <figcaption id={ids.summary} className="mt-2 text-body-sm text-on-surface-variant">
        {summary}
      </figcaption>

      <details className="mt-2 rounded-control border border-outline-variant bg-surface-container-lowest">
        <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-label-lg text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Xem bảng số liệu
        </summary>
        <div className="max-h-72 overflow-auto px-2 pb-2">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{title}: số dư cuối ngày theo từng ngày</caption>
            <thead>
              <tr className="text-left text-on-surface-variant">
                <th scope="col" className="px-2 py-1">Ngày</th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-1 text-right">{s.label}</th>
                ))}
                <th scope="col" className="px-2 py-1">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {axis.map((date) => {
                const notes = markers.filter((m) => m.date === date && m.kind !== "minimum").map((m) => m.label);
                const isMinimum = markers.some((m) => m.date === date && m.kind === "minimum");
                if (isMinimum) notes.unshift("Thấp nhất");
                return (
                  <tr key={date} className="border-t border-outline-variant/60">
                    <th scope="row" className="px-2 py-1 text-left font-normal">{formatShortDate(date)}</th>
                    {series.map((s) => {
                      const value = s.points.find((p) => p.date === date)?.value;
                      const below = showReserve && value !== undefined && value < reserve;
                      return (
                        <td key={s.id} className={`px-2 py-1 text-right tabular-nums ${below ? "font-semibold text-error" : ""}`}>
                          {value === undefined ? "–" : formatExactVnd(value)}
                          {below ? <span className="sr-only"> (dưới mức dự phòng)</span> : null}
                          {below ? <span aria-hidden="true"> ▼</span> : null}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1">{notes.join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
