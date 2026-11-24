# 06 · Deterministic Financial Engine Specification

## Invariants
- Monetary calculations run **without an LLM** and use integer VND.
- Given the same snapshot, transactions, recurrences, rules, horizon and timezone, return identical outputs.
- One transaction must never be counted twice.
- Safe purchase means **every daily projected balance** throughout the common 45-day horizon stays >=0 and >= user reserve (hence min >= max(0, reserve)).
- As-of snapshot is a starting anchor; earlier history contributes to patterns, NOT balance.

## Balance at time T
`balance(T) = snapshot_amount + SUM(signed posted transactions with occurred_at > snapshot_at and <= T)`.
Signed amounts: income `+`, expense `-`, excluded `0`. Future-dated transactions are excluded from today's balance. When the user explicitly updates snapshot, treat it as new anchor and do not reapply earlier events.

## 45-day forecast
1. Set local date `D0` from Asia/Ho_Chi_Minh clock; horizon = D0 through D0+44 (45 daily observations; clearly label inclusive range).
2. Build starting balance at current time T using snapshot+eligible recorded transactions.
3. For future dates, inject known future posted transactions once, monthly recurring incomes/expenses not yet settled once, and estimated variable daily expense once. Known recurring income must not also be counted from profile's expected monthly salary. 
4. Derive variable daily expense from 30-day recent **non-recurring, non-excluded** transactions when history quality sufficient (suggest >=7 distinct observed days and >=5 transactions); otherwise fallback to profile `expected_daily_expense_vnd` (explicitly labeled assumption). No double counting of recurring categories.
5. For each day: `balance_d = balance_prev + incomes_d - expenses_d - variable_estimate_d` (integer VND). Track min balance and first day below reserve/zero.
6. Recurring schedule: if configured day 31 in a 30-day month, apply on day 30; February leap logic; match `recurring_item_id + recurring_instance_date` to actual posted occurrence to prevent double count. For manually imported potential matching payments, request user reconciliation instead of silently guessing.

## Simulator
- Accept positive cost and two dates: `buy now` (usually D0) and `buy later` (next payday or chosen <= horizon end).
- Copy baseline projection per scenario, apply the purchase once on chosen date. Compare both over **same horizon and assumptions**, compute min balance, first breach, end balance, reserve headroom.
- Late date outside 45 days is invalid for the side-by-side result; UI explains and asks new date rather than implying future affordability.
- Fallback for unclear payday: ask user to select date; no invented payday.
- If both options unsafe, surface alternatives such as smaller purchase or postponement **without** certainty language. Never call a scenario risk-free due to sparse data.

## Rule-based alerts
- Reserve breach within forecast, expected month-end negative, discretionary spending unusual relative to prior 30-day baseline (minimum sample threshold), recurring bill due soon.
- Anomaly = statistical/spending unusual, **not** fraud evidence. Provide numeric evidence (comparison and sample), allow missing-data caveats.

## Required unit/property tests
| Test | Expected behavior |
|---|---|
| Snapshot amount 3,000,000 and expense 100,000 before snapshot | Current remains 3,000,000 |
| Expense 200,000 after snapshot | Current becomes 2,800,000 |
| Future expense after now | Excluded from today's balance, included on event day in forecast |
| Leap Feb 2028 / day 31 | Occurrence February 29 |
| Ordinary Feb 2027 / day 31 | Occurrence February 28 |
| Recorded recurring rent occurrence exists | No duplicate projected rent |
| All daily balances >= reserve | Scenario safe true |
| Interim daily balance < reserve, final > reserve | Scenario safe false |
| Imported same data twice with same request key | No double insert |
| Same input replayed 100 times | Deterministic identical results |
| Missing transaction history | Uses and reports configured fallback assumptions |
| AI provider unavailable | Forecast/simulator still work |

## Risk and uncertainty
A projection is conditional, not a balance guarantee. UI must show a plain-language assumptions section and distinguish known obligations from estimated spend. Income may arrive late or vary; warn that no linked bank balance is available.
