#!/usr/bin/env python3
"""Offline, safe pack/fixture validation. Does NOT connect to Supabase or AWS."""
from pathlib import Path
from collections import Counter
import json, csv, sys

root=Path(__file__).resolve().parent.parent

def check(ok, msg):
    if not ok: raise ValueError(msg)

personas=json.loads((root/'mock-data/personas.json').read_text(encoding='utf-8'))['personas']
recurring=json.loads((root/'mock-data/recurring-items.json').read_text(encoding='utf-8'))
goals=json.loads((root/'mock-data/savings-goals.json').read_text(encoding='utf-8'))
with (root/'mock-data/transactions.csv').open(newline='',encoding='utf-8') as f:
    transactions=list(csv.DictReader(f))
codes=[p['code'] for p in personas]
check(set(codes)=={'student','worker','at_risk'},'Expected 3 distinct personas')
check(len(set(codes))==3,'Persona codes must be unique')
check(len(goals)==3 and len(set(g['persona_code'] for g in goals))==3,'One goal per persona')
for row in transactions:
    check(row['persona_code'] in codes,'Unknown persona in transactions')
    check(int(row['amount_vnd'])>0,'Nonpositive VND amount')
    check(row['kind'] in {'income','expense','excluded'},'Invalid transaction kind')
for item in recurring:
    check(item['persona_code'] in codes and 1<=int(item['day_of_month'])<=31,'Invalid recurring record')
for p in personas:
    check(p['minimum_reserve_vnd']>=0,'Negative reserve')
    check(p['balance_snapshot_vnd']>=0,'Negative demo snapshot')
counts=Counter(r['persona_code'] for r in transactions)
check(all(counts[c]>=10 for c in codes),'Each demo persona needs >=10 transactions')
required=[
  'README.md','DECISIONS.md','AGENTS.md','.env.example',
  '.kiro/specs/finpilot-mvp/requirements.md','.kiro/specs/finpilot-mvp/design.md',
  '.kiro/specs/finpilot-mvp/tasks.md','supabase/migrations/202611230001_finpilot_initial.sql',
  'prompts/STITCH_MASTER_PROMPT.md','prompts/KIRO_BOOTSTRAP_PROMPT.md'
]
check(all((root/p).exists() for p in required),'Missing one of required pack files')
print(f'PASS: {len(personas)} personas, {len(transactions)} transactions, {len(recurring)} recurring items, {len(goals)} goals.')
print('PASS: required docs/prompts/migration present. No DB or cloud connections attempted.')
