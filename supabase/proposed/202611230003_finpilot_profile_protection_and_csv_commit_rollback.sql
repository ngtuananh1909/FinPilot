-- =====================================================================
-- PROPOSED - NOT APPLIED - requires G2 approval
-- =====================================================================
-- Rollback for 202611230003_finpilot_profile_protection_and_csv_commit.sql.
-- Not a migration; never place it in supabase/migrations. Run only with explicit G2
-- approval (see docs/18-g2-approval-pack-0003.md).
--
-- Scope: drops ONLY the 2 triggers and 2 functions that migration 0003 creates.
--   * No table, column, policy, grant on a table, or row is touched. No data is deleted.
--   * Batches and transactions already written by public.commit_csv_import stay in place.
--   * Dropping the triggers removes the protection of persona_code / is_demo / user_id
--     against client PATCH requests (a security regression); do it only to undo 0003.
--   * Uses IF EXISTS, so running it twice, or before 0003 was applied, is harmless.
-- =====================================================================
drop trigger if exists financial_profiles_protect_columns_update on public.financial_profiles;
drop trigger if exists financial_profiles_protect_columns_insert on public.financial_profiles;
drop function if exists public.commit_csv_import(uuid,text,text,jsonb,integer);
drop function if exists public.protect_profile_columns();
