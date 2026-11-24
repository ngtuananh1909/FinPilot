import { z } from "zod";

/** One validation problem. Never contains the offending value. */
export interface EnvIssue {
  readonly key: string;
  readonly reason: string;
}

/** Thrown when environment validation fails. The message lists keys only, never values. */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];
  constructor(scope: string, issues: readonly EnvIssue[]) {
    super(
      `Cấu hình môi trường ${scope} không hợp lệ: ${issues
        .map((i) => `${i.key} (${i.reason})`)
        .join(", ")}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Blank strings (e.g. `AI_API_KEY=` copied from .env.example) count as unset. */
export const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export function optionalString() {
  return z.preprocess(blankToUndefined, z.string().optional());
}

export function parseEnv<S extends z.ZodType>(
  scope: string,
  schema: S,
  source: EnvSource,
): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvValidationError(
    scope,
    result.error.issues.map((issue) => ({
      key: String(issue.path[0] ?? "(unknown)"),
      // Use the issue code only: zod messages may echo received values.
      reason: issue.code === "invalid_type" ? "thiếu hoặc sai kiểu" : "giá trị không hợp lệ",
    })),
  );
}
