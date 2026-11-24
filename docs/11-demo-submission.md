# 11 · Demo Story, Personas, and Contest Submission

## End-to-end judge demo (suggested <= 3-minute recording)
- **0:00–0:20:** Describe problem: unpredictable cashflow; need a decision support tool.
- **0:20–0:40:** On Welcome choose one of 3 Guest personas; show Dashboard running on public URL.
- **0:40–1:00:** CSV import preview or AI receipt scan; correct and confirm a sample transaction.
- **1:00–1:45:** Simulator buy now vs after payday; point to lowest balance, reserve threshold and impact over 45 days.
- **1:45–2:25:** Ask AI why one scenario is risky; show **real tool call** + structured explanation; suggest adjusting budget and explicitly confirm (or reject) proposal.
- **2:25–3:00:** Show Settings reserve/goal and reset capability, key value proposition, public product URL.

## Synthetic fixture personas
| Code | Context | Illustrative monthly available income/allowance | Key storyline |
|---|---|---:|---|
| `student` | Student, rent/food/education | 5,000,000 VND | Can they buy a device before rent? |
| `worker` | Early-career employee, rent/transport | 12,000,000 VND | Purchase now vs after payday |
| `at_risk` | Tight discretionary budget and bills | 9,000,000 VND | 45-day shortfall and suggested adjustment |

Generated data are **fictional**, with consistent snapshot timestamps and transaction dates, and not sourced from genuine customer accounts. Avoid using personal emails/names of real individuals in demo files.

## Submission checklist
- [ ] Website reachable publicly via AWS Amplify on all relevant devices.
- [ ] 1-page A4 PDF usage guide with link + 3 demo account credentials (securely distributed according to contest instructions) and guest option.
- [ ] Source ZIP (exclude `.env.local`, secrets, private receipts), README with run instructions, technology, reused assets/open-source licenses/AI tools.
- [ ] PDF slide deck <=10 slides, frozen after submission; problem, personas, solution, AI, demo, tests, impact, safeguards.
- [ ] MP4 <=3 minutes showing **real running web app**.
- [ ] Security and quota smoke tests done; API bill estimates checked.
- [ ] Public site and resources kept active through judging date.
- [ ] User has explicitly approved release and final submission.

## Avoid overstated claims
Do not claim bank integration, actual fraud prevention, personalized regulated financial advice, safe spending guarantee or measured results without actual measured evidence. Compare measured prototype results only when real tests exist.
