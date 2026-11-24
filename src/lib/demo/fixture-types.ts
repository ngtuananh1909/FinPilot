import type { PersonaCode } from "@/lib/db/schema";

/** Amounts are decimal strings: JSON has no bigint and the SQL template parser accepts strings. */
export interface DemoRecurringFixture {
  label: string;
  kind: "income" | "expense";
  amountVnd: string;
  dayOfMonth: number;
  category: string;
  /** Fixture-time calendar date (YYYY-MM-DD); shifted when a template is built. */
  startDate: string;
  active: boolean;
}

export interface DemoTransactionFixture {
  /** ISO instant with +07:00 offset at fixture time; shifted when a template is built. */
  occurredAt: string;
  kind: "income" | "expense" | "excluded";
  amountVnd: string;
  category: string;
  merchant: string;
  description: string;
}

export interface DemoPersonaFixture {
  code: PersonaCode;
  displayName: string;
  story: string;
  profile: {
    balanceSnapshotVnd: string;
    expectedMonthlyIncomeVnd: string;
    paydayDay: number;
    expectedDailyExpenseVnd: string;
    projectedMonthlyBudgetVnd: string;
    minimumReserveVnd: string;
  };
  recurringItems: DemoRecurringFixture[];
  transactions: DemoTransactionFixture[];
  goal: { name: string; targetVnd: string; savedVnd: string; targetDate: string };
}

export interface DemoFixtures {
  /** Calendar date the fixture was authored against (not a runtime "today"). */
  referenceDate: string;
  timezone: string;
  personas: Record<PersonaCode, DemoPersonaFixture>;
}
