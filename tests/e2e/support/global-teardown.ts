import { existsSync } from "node:fs";
import { deleteRecordedUsers } from "./cleanup";

export default async function globalTeardown(): Promise<void> {
  // Node loads the same variables the app uses; values are never printed.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { deleted, failed } = await deleteRecordedUsers();
  console.log(`[e2e cleanup] deleted ${deleted} throwaway guest user(s) by id${failed.length ? `; FAILED ids: ${failed.join(", ")}` : ""}`);
}
