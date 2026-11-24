import { z } from "zod";
import { AppError } from "@/lib/errors";
import { addDays, diffDays, localDateOf, parseLocalDate, type LocalDate } from "@/lib/finance";
import type { PersonaCode } from "@/lib/db/schema";
import type { DemoFixtures } from "./fixture-types";
import { DEMO_FIXTURES } from "./fixtures.generated";

/** JSON accepted by the SQL function `reset_user_to_persona` (snake_case, amounts as strings). */
export interface PersonaTemplate {
  persona_code: PersonaCode;
  profile: {
    display_name: string;
    balance_snapshot_vnd: string;
    balance_snapshot_at: string;
    expected_monthly_income_vnd: string;
    payday_day: number;
    expected_daily_expense_vnd: string;
    projected_monthly_budget_vnd: string;
    minimum_reserve_vnd: string;
    is_demo: true;
  };
  recurring_items: Array<{
    label: string;
    kind: "income" | "expense";
    amount_vnd: string;
    day_of_month: number;
    category: string;
    start_date: string;
    active: boolean;
  }>;
  transactions: Array<{
    occurred_at: string;
    kind: "income" | "expense" | "excluded";
    amount_vnd: string;
    category: string;
    merchant: string;
    description: string;
  }>;
  goal: { name: string; target_vnd: string; saved_vnd: string; target_date: string };
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const INSTANT_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/;
const MAX_TRANSACTIONS = 500;
const MAX_RECURRING = 50;

/** ISO-8601 instant rendered in Asia/Ho_Chi_Minh (+07:00), second precision. */
export function toVietnamIso(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new AppError("internal");
  const shifted = new Date(instant.getTime() + VN_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

function shiftInstant(value: string, deltaDays: number): string {
  const match = INSTANT_WITH_OFFSET.exec(value);
  if (!match) throw new AppError("internal");
  return `${addDays(match[1]!, deltaDays)}${match[2]!}${match[3]!}`;
}

const amountString = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
const templateSchema = z.object({
  persona_code: z.enum(["student", "worker", "at_risk"]),
  profile: z.object({
    display_name: z.string().trim().min(1).max(80),
    balance_snapshot_vnd: amountString,
    balance_snapshot_at: z.string(),
    expected_monthly_income_vnd: amountString,
    payday_day: z.number().int().min(1).max(31),
    expected_daily_expense_vnd: amountString,
    projected_monthly_budget_vnd: amountString,
    minimum_reserve_vnd: amountString,
    is_demo: z.literal(true),
  }),
  recurring_items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(100),
        kind: z.enum(["income", "expense"]),
        amount_vnd: amountString.refine((v) => BigInt(v) >= 1n),
        day_of_month: z.number().int().min(1).max(31),
        category: z.string().trim().min(1).max(50),
        start_date: z.string(),
        active: z.boolean(),
      }),
    )
    .max(MAX_RECURRING),
  transactions: z
    .array(
      z.object({
        occurred_at: z.string(),
        kind: z.enum(["income", "expense", "excluded"]),
        amount_vnd: amountString.refine((v) => BigInt(v) >= 1n),
        category: z.string().trim().min(1).max(50),
        merchant: z.string().max(200),
        description: z.string().max(500),
      }),
    )
    .max(MAX_TRANSACTIONS),
  goal: z.object({
    name: z.string().trim().min(1).max(100),
    target_vnd: amountString.refine((v) => BigInt(v) >= 1n),
    saved_vnd: amountString,
    target_date: z.string(),
  }),
});

/**
 * Builds the clone template for one persona. Pure: `now` is injected.
 *
 * Date handling (mock-data/README.md): every fixture date moves by the SAME calendar-day
 * delta between the fixture reference date and today's Asia/Ho_Chi_Minh date, keeping each
 * transaction's time of day. The balance snapshot is anchored at `now`, which is after every
 * shifted transaction, so history informs analytics but is never subtracted from the balance.
 */
export function buildPersonaTemplate(
  personaCode: PersonaCode,
  now: Date,
  fixtures: DemoFixtures = DEMO_FIXTURES,
): PersonaTemplate {
  const persona = fixtures.personas[personaCode];
  if (!persona) throw new AppError("validation_failed");

  const today = localDateOf(now);
  parseLocalDate(fixtures.referenceDate);
  const deltaDays = diffDays(today, fixtures.referenceDate);
  const shiftDate = (date: LocalDate): LocalDate => addDays(date, deltaDays);
  const snapshotAt = toVietnamIso(now);

  const template: PersonaTemplate = {
    persona_code: persona.code,
    profile: {
      display_name: persona.displayName,
      balance_snapshot_vnd: persona.profile.balanceSnapshotVnd,
      balance_snapshot_at: snapshotAt,
      expected_monthly_income_vnd: persona.profile.expectedMonthlyIncomeVnd,
      payday_day: persona.profile.paydayDay,
      expected_daily_expense_vnd: persona.profile.expectedDailyExpenseVnd,
      projected_monthly_budget_vnd: persona.profile.projectedMonthlyBudgetVnd,
      minimum_reserve_vnd: persona.profile.minimumReserveVnd,
      is_demo: true,
    },
    recurring_items: persona.recurringItems.map((item) => ({
      label: item.label,
      kind: item.kind,
      amount_vnd: item.amountVnd,
      day_of_month: item.dayOfMonth,
      category: item.category,
      start_date: shiftDate(item.startDate),
      active: item.active,
    })),
    transactions: persona.transactions.map((tx) => ({
      occurred_at: shiftInstant(tx.occurredAt, deltaDays),
      kind: tx.kind,
      amount_vnd: tx.amountVnd,
      category: tx.category,
      merchant: tx.merchant,
      description: tx.description,
    })),
    goal: {
      name: persona.goal.name,
      target_vnd: persona.goal.targetVnd,
      saved_vnd: persona.goal.savedVnd,
      target_date: shiftDate(persona.goal.targetDate),
    },
  };

  const parsed = templateSchema.safeParse(template);
  if (!parsed.success) throw new AppError("internal", { cause: parsed.error });

  // Invariant: all history is strictly older than the snapshot, so it cannot alter the balance.
  const snapshotMs = new Date(snapshotAt).getTime();
  for (const tx of template.transactions) {
    if (!(new Date(tx.occurred_at).getTime() < snapshotMs)) {
      throw new AppError("internal", { cause: new Error("fixture transaction not older than snapshot") });
    }
  }
  return template;
}
