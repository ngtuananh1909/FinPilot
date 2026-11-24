import { formatShortDate } from "@/lib/format/date-vi";
import { formatVndText } from "@/lib/format/vnd";
import type { PurchaseSimulation, ScenarioResult } from "@/lib/finance";

export const SIMULATION_CAVEAT =
  "Kết quả chỉ là ước tính dựa trên số dư bạn đã nhập và các giả định bên dưới, không phải cam kết. " +
  "Thu nhập có thể đến muộn hoặc khác dự kiến, chi tiêu thực tế có thể khác, và FinPilot không kết nối ngân hàng.";

const vnd = (amount: bigint) => formatVndText(amount.toString());
const NAME: Record<ScenarioResult["name"], string> = { now: "Mua ngay", later: "Mua sau" };

function describeScenario(s: ScenarioResult, reserve: bigint): string {
  const head = `${NAME[s.name]} (${formatShortDate(s.purchaseDate)})`;
  if (s.safe) {
    return (
      `${head}: theo ước tính, số dư thấp nhất là ${vnd(s.minimumVnd)} vào ${formatShortDate(s.minimumDate)}, ` +
      `vẫn giữ ≥ mức dự phòng ${vnd(reserve)}; kết quả này chưa chắc chắn.`
    );
  }
  const breach = s.firstBreachDate ? `, ngày đầu tiên là ${formatShortDate(s.firstBreachDate)}` : "";
  const level =
    s.violation === "below_zero"
      ? `xuống âm (${vnd(s.minimumVnd)} vào ${formatShortDate(s.minimumDate)}), thấp hơn mức dự phòng ${vnd(reserve)}`
      : `xuống ${vnd(s.minimumVnd)} vào ${formatShortDate(s.minimumDate)}, thiếu ${vnd(-s.reserveHeadroomVnd)} so với mức dự phòng ${vnd(reserve)}`;
  let text = `${head}: theo ước tính, số dư ${level}; có ${s.reserveBreachDays} ngày dưới mức dự phòng${breach}.`;
  if (s.endBalanceVnd >= reserve) {
    text += ` Dù số dư cuối kỳ (${vnd(s.endBalanceVnd)}) cao hơn mức dự phòng, có ngày giữa kỳ bị vi phạm nên kịch bản này không được tính là giữ được mức dự phòng.`;
  }
  return text;
}

/**
 * Plain-language Vietnamese conclusions from the engine's result. Pure formatting: every number is
 * taken from `sim`, nothing is recomputed except the "reduce by" hint (reserve - lowest balance),
 * which is exact only when the baseline itself respects the reserve (checked below).
 * Wording rule: never claims safety or a guarantee; always "theo ước tính" and mentions the reserve.
 */
export function buildConclusions(sim: PurchaseSimulation, itemName: string | null): string[] {
  const { now, later } = sim.scenarios;
  const subject = itemName ? `“${itemName}”` : "khoản mua này";
  const lines: string[] = [
    `Giá trị ${subject}: ${vnd(sim.costVnd)}. Mức dự phòng tối thiểu của bạn: ${vnd(sim.reserveVnd)}.`,
    describeScenario(now, sim.reserveVnd),
    describeScenario(later, sim.reserveVnd),
  ];
  if (sim.buyLaterSource === "next_payday") {
    lines.push(`“Mua sau” lấy ngày nhận thu nhập dự kiến tiếp theo (${formatShortDate(later.purchaseDate)}).`);
  }

  if (now.safe && later.safe) {
    lines.push(
      sim.minimumImprovementVnd > 0n
        ? `Cả hai cách đều giữ ≥ mức dự phòng theo ước tính. Mua sau giữ mức số dư thấp nhất cao hơn ${vnd(sim.minimumImprovementVnd)}, tức có thêm khoảng đệm so với mức dự phòng, nhưng vẫn chưa chắc chắn.`
        : "Cả hai cách đều giữ ≥ mức dự phòng theo ước tính và có cùng mức số dư thấp nhất; kết quả vẫn chưa chắc chắn.",
    );
  } else if (!now.safe && later.safe) {
    lines.push(
      "Theo ước tính, chỉ “Mua sau” giữ ≥ mức dự phòng. Bạn có thể cân nhắc dời thời điểm mua, nhưng kết quả vẫn chưa chắc chắn.",
    );
  } else if (now.safe && !later.safe) {
    lines.push("Theo ước tính, “Mua sau” không giữ ≥ mức dự phòng trong khi “Mua ngay” thì có; hãy kiểm tra lại các giả định.");
  } else {
    lines.push("Theo ước tính, cả hai cách đều chưa giữ được mức dự phòng. Hãy cân nhắc hoãn việc mua hoặc giảm số tiền.");
    if (sim.baseline.safe) {
      const shortfall = -later.reserveHeadroomVnd;
      lines.push(
        `Để “Mua sau” giữ ≥ mức dự phòng, cần giảm giá trị mua ít nhất ${vnd(shortfall)} (theo ước tính, chưa chắc chắn).`,
      );
    } else {
      lines.push(
        "Ngay cả khi chưa mua gì, dự báo hiện tại đã xuống dưới mức dự phòng, nên việc giảm giá trị mua có thể chưa đủ.",
      );
    }
  }
  return lines;
}
