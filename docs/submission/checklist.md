# Submission checklist (status 2026-11-24)

| Item (docs/11) | Status | Owner action |
|---|---|---|
| Public website on AWS Amplify | **Not done** (G4 not approved) | Follow docs/19, approve push |
| 1-page A4 usage guide PDF | Draft `docs/submission/usage-guide-A4.md` | Fill URL, export to PDF |
| 3 demo account credentials | **Blocked**: accounts not created (`SEED_USER_*` unset) | Fill `SEED_USER_*`, run `npm run seed:demo` then `seed:demo:apply` |
| Source ZIP (no secrets) | Script `scripts/make-source-zip.sh` (lists files; `--write` creates the zip) | Run after final commit |
| README with run instructions, stack, licenses, AI tools | Done `README.md` | Review |
| ≤ 10 slides PDF | Outline `docs/submission/slides-outline.md` | Build slides, export PDF |
| ≤ 3 min MP4 of the real app | Script `docs/submission/demo-script.md` | Record after deploy and AI configuration |
| Security and quota smoke tests | Local + live DB done (`docs/evidence/ac-matrix.md`); hosted smoke pending | Run docs/19 §6 after deploy |
| API bill estimate | Pending: depends on chosen model | Set provider spend cap; quotas cap usage at 20 chats + 5 scans per user/day |
| Keep site active through judging | Pending | Do not change after cutoff |
| Owner approval of release and submission | Pending | Explicit approval required |
