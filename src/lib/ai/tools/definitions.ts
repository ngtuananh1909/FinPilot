import { z } from "zod";
import type { ToolDefinition } from "../transport";

/**
 * Allowlisted tools exposed to the model. Every argument schema is `.strict()`: any extra key
 * (user_id, owner, url, sql, ...) makes the call fail with `invalid_arguments` and nothing runs.
 * The owner is NEVER an argument: handlers take it from the verified request context.
 */

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveVndString = z.string().regex(/^[1-9][0-9]{0,15}$/);
const reason = z.string().trim().min(1).max(500);

export const READ_TOOL_SCHEMAS = {
  get_financial_snapshot: z.object({}).strict(),
  list_transactions: z
    .object({
      fromDate: localDate.optional(),
      toDate: localDate.optional(),
      kind: z.enum(["income", "expense", "excluded"]).optional(),
      category: z.string().trim().min(1).max(50).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  get_spending_breakdown: z.object({ fromDate: localDate, toDate: localDate }).strict(),
  forecast_cashflow: z.object({}).strict(),
  simulate_purchase: z
    .object({
      costVnd: positiveVndString,
      buyNowDate: localDate.optional(),
      buyLater: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("next_payday") }).strict(),
        z.object({ kind: z.literal("date"), date: localDate }).strict(),
      ]),
    })
    .strict(),
  get_savings_goal: z.object({}).strict(),
} as const;

export const PROPOSAL_TOOL_SCHEMAS = {
  propose_budget_adjustment: z.object({ newProjectedMonthlyBudgetVnd: z.string().regex(/^(0|[1-9][0-9]{0,15})$/), reason }).strict(),
  propose_savings_goal_update: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      targetVnd: positiveVndString.optional(),
      targetDate: localDate.nullable().optional(),
      reason,
    })
    .strict()
    .refine((v) => v.name !== undefined || v.targetVnd !== undefined || v.targetDate !== undefined, { message: "no_change" }),
} as const;

export type ReadToolName = keyof typeof READ_TOOL_SCHEMAS;
export type ProposalToolName = keyof typeof PROPOSAL_TOOL_SCHEMAS;
export type ToolName = ReadToolName | ProposalToolName;

const dateProp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Ngày YYYY-MM-DD theo giờ Việt Nam" };
const vndProp = { type: "string", pattern: "^[1-9][0-9]*$", description: "Số tiền VND nguyên dương, dạng chuỗi chữ số" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const fn = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({
  type: "function",
  function: { name, description, parameters },
});

export const READ_TOOLS: readonly ToolDefinition[] = [
  fn("get_financial_snapshot", "Số dư ước tính hiện tại, thu/chi tháng này, mức dự phòng và mức độ đầy đủ dữ liệu của người dùng hiện tại.", obj({})),
  fn(
    "list_transactions",
    "Liệt kê tối đa 50 giao dịch gần nhất của người dùng hiện tại, có thể lọc theo khoảng ngày, loại, danh mục.",
    obj({
      fromDate: dateProp,
      toDate: dateProp,
      kind: { type: "string", enum: ["income", "expense", "excluded"] },
      category: { type: "string", maxLength: 50 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    }),
  ),
  fn(
    "get_spending_breakdown",
    "Tổng chi tiêu theo danh mục trong một khoảng ngày (tối đa 92 ngày), phần trăm tính sẵn.",
    obj({ fromDate: dateProp, toDate: dateProp }, ["fromDate", "toDate"]),
  ),
  fn("forecast_cashflow", "Dự báo số dư từng ngày trong 45 ngày tới (động cơ tính toán xác định), kèm điểm thấp nhất và cảnh báo mức dự phòng.", obj({})),
  fn(
    "simulate_purchase",
    "So sánh mua ngay và mua sau (ngày lương kế tiếp hoặc ngày chọn trong 45 ngày) trên cùng một dự báo. Không thực hiện mua.",
    obj(
      {
        costVnd: vndProp,
        buyNowDate: dateProp,
        buyLater: {
          oneOf: [
            obj({ kind: { type: "string", enum: ["next_payday"] } }, ["kind"]),
            obj({ kind: { type: "string", enum: ["date"] }, date: dateProp }, ["kind", "date"]),
          ],
        },
      },
      ["costVnd", "buyLater"],
    ),
  ),
  fn("get_savings_goal", "Mục tiêu tiết kiệm đang có của người dùng hiện tại (tối đa một mục tiêu), kèm tiến độ.", obj({})),
];

export const PROPOSAL_TOOLS: readonly ToolDefinition[] = [
  fn(
    "propose_budget_adjustment",
    "ĐỀ XUẤT ngân sách chi tiêu tháng mới. Chỉ tạo đề xuất chờ người dùng xác nhận; không thay đổi dữ liệu.",
    obj({ newProjectedMonthlyBudgetVnd: { type: "string", pattern: "^[0-9]+$" }, reason: { type: "string", maxLength: 500 } }, [
      "newProjectedMonthlyBudgetVnd",
      "reason",
    ]),
  ),
  fn(
    "propose_savings_goal_update",
    "ĐỀ XUẤT thay đổi mục tiêu tiết kiệm (tên, số tiền mục tiêu, hạn). Chỉ tạo đề xuất chờ người dùng xác nhận; không chuyển tiền.",
    obj(
      {
        name: { type: "string", maxLength: 100 },
        targetVnd: vndProp,
        targetDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        reason: { type: "string", maxLength: 500 },
      },
      ["reason"],
    ),
  ),
];

export const ALL_TOOLS: readonly ToolDefinition[] = [...READ_TOOLS, ...PROPOSAL_TOOLS];
