-- Intentionally no automatic remote demo seeding.
-- The app shares ONE Supabase database between local dev and AWS judges.
-- Supabase CLI can run seed.sql during local reset and optional hosted seed steps:
-- DO NOT add 3 demo users / credentials here or run remote reset.
-- Seed templates live in mock-data/; after approval, Kiro implements an idempotent
-- per-owner script using Supabase Auth Admin API and owner-scoped inserts.
select 1;
