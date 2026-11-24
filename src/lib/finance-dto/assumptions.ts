import { vndToString, type Assumption } from "@/lib/finance";
import { formatVndText } from "@/lib/format/vnd";

/** Wire shape of an engine assumption: amounts as decimal strings, no bigint. */
export type AssumptionDto =
  | {
      code: "variable_expense_history";
      dailyVnd: string;
      sampleTransactionCount: number;
      sampleDayCount: number;
      windowDays: number;
    }
  | {
      code: "variable_expense_profile_fallback";
      dailyVnd: string;
      sampleTransactionCount: number;
      sampleDayCount: number;
    }
  | { code: "variable_expense_missing" }
  | { code: "income_from_profile"; monthlyVnd: string; paydayDay: number };

export function assumptionToDto(assumption: Assumption): AssumptionDto {
  switch (assumption.code) {
    case "variable_expense_history":
      return {
        code: assumption.code,
        dailyVnd: vndToString(assumption.dailyVnd),
        sampleTransactionCount: assumption.sampleTransactionCount,
        sampleDayCount: assumption.sampleDayCount,
        windowDays: assumption.windowDays,
      };
    case "variable_expense_profile_fallback":
      return {
        code: assumption.code,
        dailyVnd: vndToString(assumption.dailyVnd),
        sampleTransactionCount: assumption.sampleTransactionCount,
        sampleDayCount: assumption.sampleDayCount,
      };
    case "variable_expense_missing":
      return { code: assumption.code };
    case "income_from_profile":
      return { code: assumption.code, monthlyVnd: vndToString(assumption.monthlyVnd), paydayDay: assumption.paydayDay };
  }
}

/** Plain-language Vietnamese sentence for an assumption (known vs estimated is stated explicitly). */
export function describeAssumption(a: AssumptionDto): string {
  switch (a.code) {
    case "variable_expense_history":
      return (
        `Chi tiêu hằng ngày được ước tính ${formatVndText(a.dailyVnd)}/ngày từ ${a.sampleTransactionCount} giao dịch ` +
        `không định kỳ trong ${a.sampleDayCount} ngày (trung bình trên khoảng ${a.windowDays} ngày gần đây).`
      );
    case "variable_expense_profile_fallback":
      return (
        `Lịch sử chưa đủ (${a.sampleTransactionCount} giao dịch trong ${a.sampleDayCount} ngày) nên dùng mức chi tiêu ` +
        `hằng ngày bạn đã nhập: ${formatVndText(a.dailyVnd)}/ngày.`
      );
    case "variable_expense_missing":
      return "Chưa có mức chi tiêu hằng ngày ước tính, nên dự báo chưa tính chi tiêu thay đổi hằng ngày và có thể quá lạc quan.";
    case "income_from_profile":
      return (
        `Thu nhập ${formatVndText(a.monthlyVnd)}/tháng vào ngày ${a.paydayDay} lấy từ hồ sơ của bạn ` +
        `(chưa có khoản thu định kỳ nào được khai báo). Thu nhập có thể đến muộn hoặc khác dự kiến.`
      );
  }
}
