import { describe, expect, it } from "vitest";
import { SIMULATION_CAVEAT, buildConclusions } from "@/features/simulator/conclusions";
import type { PurchaseSimulation } from "@/lib/finance";
import { runSimulation } from "./fixtures";

// Words that would promise safety. "chưa chắc chắn" (not certain) is the hedge we WANT, so a bare
// "chắc chắn" only counts when it is not negated.
const GUARANTEES: RegExp[] = [
  /đảm bảo/i,
  /(?<!chưa )chắc chắn/i,
  /an toàn tuyệt đối/i,
  /không rủi ro/i,
  /hoàn toàn an toàn/i,
  /cam kết/i,
  /\bantoan\b/i,
];

const base = { balance: 3_000_000n, reserve: 1_000_000n };
const SCENARIOS = {
  bothSafeNoGain: runSimulation({ balance: 10_000_000n, reserve: 1_000_000n, cost: 1_000_000n, buyLater: { kind: "date", date: "2026-11-30" } }),
  bothSafeWithGain: runSimulation({
    balance: 4_000_000n,
    reserve: 1_000_000n,
    monthlyIncome: 5_000_000n,
    paydayDay: 5,
    cost: 2_000_000n,
    buyLater: { kind: "next_payday" },
  }),
  onlyLaterSafe: runSimulation({ ...base, monthlyIncome: 5_000_000n, paydayDay: 5, cost: 2_500_000n, buyLater: { kind: "next_payday" } }),
  bothBelowReserveBaselineSafe: runSimulation({ ...base, cost: 2_500_000n, buyLater: { kind: "date", date: "2026-11-30" } }),
  bothBelowZero: runSimulation({ ...base, cost: 5_000_000n, buyLater: { kind: "date", date: "2026-11-30" } }),
  bothUnsafeBaselineUnsafe: runSimulation({ balance: 800_000n, reserve: 1_000_000n, cost: 100_000n, buyLater: { kind: "date", date: "2026-11-30" } }),
} satisfies Record<string, PurchaseSimulation>;

/** The engine never lets "later" be worse than "now" for a later date, so this branch is built by flipping a real result. */
const onlyNowSafe: PurchaseSimulation = (() => {
  const unsafeBoth = SCENARIOS.bothBelowReserveBaselineSafe;
  const safe = SCENARIOS.bothSafeNoGain.scenarios.now;
  return {
    ...unsafeBoth,
    bothUnsafe: false,
    scenarios: { now: { ...safe, name: "now" }, later: unsafeBoth.scenarios.later },
  };
})();

const ALL: Array<[string, PurchaseSimulation]> = [...Object.entries(SCENARIOS), ["onlyNowSafe (flipped)", onlyNowSafe]];

describe("buildConclusions: wording", () => {
  it("fixtures really cover the intended cases", () => {
    const flags = (s: PurchaseSimulation) => [s.scenarios.now.safe, s.scenarios.later.safe];
    expect(flags(SCENARIOS.bothSafeNoGain)).toEqual([true, true]);
    expect(flags(SCENARIOS.bothSafeWithGain)).toEqual([true, true]);
    expect(SCENARIOS.bothSafeWithGain.minimumImprovementVnd > 0n).toBe(true);
    expect(SCENARIOS.bothSafeNoGain.minimumImprovementVnd).toBe(0n);
    expect(flags(SCENARIOS.onlyLaterSafe)).toEqual([false, true]);
    expect(flags(onlyNowSafe)).toEqual([true, false]);
    expect(SCENARIOS.bothBelowReserveBaselineSafe.scenarios.now.violation).toBe("below_reserve");
    expect(SCENARIOS.bothBelowZero.scenarios.now.violation).toBe("below_zero");
    expect(SCENARIOS.bothBelowZero.scenarios.later.violation).toBe("below_zero");
    expect(SCENARIOS.bothUnsafeBaselineUnsafe.baseline.safe).toBe(false);
  });

  it.each(ALL)("%s: never promises safety, always hedges as an estimate", (_name, sim) => {
    const lines = buildConclusions(sim, "Bàn phím");
    const text = lines.join("\n");
    for (const forbidden of GUARANTEES) expect(text, String(forbidden)).not.toMatch(forbidden);
    expect(text).toContain("theo ước tính");
    expect(text).not.toMatch(/\b(?:fraud|gian lận)\b/i);
    expect(`${SIMULATION_CAVEAT}`).toMatch(/không phải cam kết/);
    expect(SIMULATION_CAVEAT).not.toMatch(/(?<!không phải )(?<!chưa )(?:đảm bảo|chắc chắn)/);
  });

  it.each(ALL)("%s: states the reserve amount", (_name, sim) => {
    const reserve = sim.reserveVnd.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    expect(buildConclusions(sim, null)[0]).toContain(`${reserve} ₫`);
    for (const line of buildConclusions(sim, null).slice(1, 3)) expect(line).toContain(`${reserve} ₫`);
  });
});

describe("buildConclusions: per case", () => {
  it("both safe: says both keep the reserve and stays unsure; quantifies the gain only when positive", () => {
    const noGain = buildConclusions(SCENARIOS.bothSafeNoGain, null).join("\n");
    expect(noGain).toContain("Cả hai cách đều giữ ≥ mức dự phòng theo ước tính và có cùng mức số dư thấp nhất");
    expect(noGain).toContain("chưa chắc chắn");
    const gain = buildConclusions(SCENARIOS.bothSafeWithGain, null).join("\n");
    expect(gain).toContain("Mua sau giữ mức số dư thấp nhất cao hơn 2.000.000 ₫");
    expect(gain).toContain("chưa chắc chắn");
  });

  it("only later safe: names Mua sau as the only option that keeps the reserve", () => {
    const lines = buildConclusions(SCENARIOS.onlyLaterSafe, null);
    expect(lines.at(-1)).toMatch(/chỉ “Mua sau” giữ ≥ mức dự phòng/);
    expect(lines.at(-1)).toContain("chưa chắc chắn");
    expect(lines.join("\n")).toContain("thiếu"); // the unsafe 'now' scenario reports the shortfall against the reserve
  });

  it("only now safe: tells the user to re-check assumptions instead of recommending", () => {
    expect(buildConclusions(onlyNowSafe, null).at(-1)).toContain("“Mua sau” không giữ ≥ mức dự phòng trong khi “Mua ngay” thì có");
  });

  it("both unsafe, baseline safe: suggests postponing/reducing with the exact shortfall and a hedge", () => {
    const sim = SCENARIOS.bothBelowReserveBaselineSafe;
    const lines = buildConclusions(sim, null);
    expect(lines.join("\n")).toContain("cả hai cách đều chưa giữ được mức dự phòng");
    expect(lines.join("\n")).toContain("hoãn việc mua hoặc giảm số tiền");
    // 3.000.000 - 2.500.000 = 500.000 lowest; reserve 1.000.000 => short by 500.000
    expect(lines.at(-1)).toContain("giảm giá trị mua ít nhất 500.000 ₫");
    expect(lines.at(-1)).toContain("chưa chắc chắn");
  });

  it("both unsafe, baseline already unsafe: no reduction promise", () => {
    const lines = buildConclusions(SCENARIOS.bothUnsafeBaselineUnsafe, null);
    expect(lines.at(-1)).toContain("Ngay cả khi chưa mua gì");
    expect(lines.at(-1)).toContain("có thể chưa đủ");
    expect(lines.join("\n")).not.toContain("giảm giá trị mua ít nhất");
  });

  it("below zero: says the balance goes negative and still names the reserve", () => {
    const sim = SCENARIOS.bothBelowZero;
    const lines = buildConclusions(sim, null);
    expect(lines[1]).toContain("xuống âm");
    expect(lines[1]).toContain("-2.000.000 ₫");
    expect(lines[1]).toContain("mức dự phòng 1.000.000 ₫");
    expect(lines[1]).toMatch(/có \d+ ngày dưới mức dự phòng/);
  });

  it("below reserve (not below zero): reports the shortfall in VND against the reserve", () => {
    const line = buildConclusions(SCENARIOS.bothBelowReserveBaselineSafe, null)[1]!;
    expect(line).toContain("thiếu 500.000 ₫ so với mức dự phòng 1.000.000 ₫");
    expect(line).not.toContain("xuống âm");
  });

  it("interim breach with a healthy end balance is marked as not keeping the reserve (AC-10 wording)", () => {
    // Payday inside the window lifts the end balance above the reserve although the early days are below it.
    const sim = runSimulation({ ...base, monthlyIncome: 5_000_000n, paydayDay: 5, cost: 2_500_000n, buyLater: { kind: "date", date: "2026-11-30" } });
    expect(sim.scenarios.now.safe).toBe(false);
    expect(sim.scenarios.now.endBalanceVnd >= sim.reserveVnd).toBe(true);
    const line = buildConclusions(sim, null)[1]!;
    expect(line).toContain("có ngày giữa kỳ bị vi phạm nên kịch bản này không được tính là giữ được mức dự phòng");
  });

  it("names the item in quotes, or falls back to a neutral phrase", () => {
    const sim = SCENARIOS.bothSafeNoGain;
    expect(buildConclusions(sim, "Bàn phím")[0]).toContain("“Bàn phím”");
    expect(buildConclusions(sim, null)[0]).toContain("khoản mua này");
  });

  it("mentions the payday basis only for next_payday", () => {
    expect(buildConclusions(SCENARIOS.onlyLaterSafe, null).join("\n")).toContain("ngày nhận thu nhập dự kiến tiếp theo (05/12)");
    expect(buildConclusions(SCENARIOS.bothSafeNoGain, null).join("\n")).not.toContain("ngày nhận thu nhập dự kiến tiếp theo");
  });
});
