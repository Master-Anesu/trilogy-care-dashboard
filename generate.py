#!/usr/bin/env python3
"""
generate.py — Regenerate index.html from a fresh Zoho CSV export

Usage:
    python3 generate.py Consumers_2026_04_09.csv

Output:
    index.html (ready to commit and push to GitHub Pages)
"""

import csv, json, sys, re
from datetime import datetime, date
from pathlib import Path

if len(sys.argv) < 2:
    print("Usage: python3 generate.py <path-to-zoho-export.csv>")
    sys.exit(1)

CSV_PATH = sys.argv[1]
TODAY = date.today()
ORG_ID = "4637899"

REP_EMAILS = {
    "Aprocina Anthony":        "aprocina.anthony@trilogycare.com.au",
    "Matthew Farrelly":        "matthew.farrelly@trilogycare.com.au",
    "Heidi Brdoch":            "heidi.brdoch@trilogycare.com.au",
    "Luke Saito":              "luke.saito@trilogycare.com.au",
    "Corey McConkie":          "corey.mcconkie@trilogycare.com.au",
    "Caitlin Burrill":         "caitlin.burrill@trilogycare.com.au",
    "Stella Su'a":             "stella.sua@trilogycare.com.au",
    "Hunter Goodfellow":       "hunter.goodfellow@trilogycare.com.au",
    "Sophie Farrow":           "sophie.farrow@trilogycare.com.au",
    "Bonheur Chala":           "bonheur.chala@trilogycare.com.au",
    "Telesia Mau'u":           "telesia.mauu@trilogycare.com.au",
    "Ehtisham Muhammad Mehdi": "ehtisham.mehdi@trilogycare.com.au",
    "Anesu Taderera":          "anesu.taderera@trilogycare.com.au",
}

def days_since(dt_str):
    if not dt_str or not dt_str.strip():
        return None
    try:
        return (TODAY - datetime.strptime(dt_str.strip()[:10], '%Y-%m-%d').date()).days
    except:
        return None

def make_email(name):
    parts = name.lower().split()
    if len(parts) >= 2:
        return f"{parts[0]}.{parts[-1]}@trilogycare.com.au"
    return f"{parts[0]}@trilogycare.com.au"

print(f"Reading {CSV_PATH}...")
with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

records = []
for r in rows:
    closing = r.get('Closing Date', '').strip()
    closing_overdue = None
    if closing:
        try:
            cd = datetime.strptime(closing[:10], '%Y-%m-%d').date()
            if cd < TODAY:
                closing_overdue = (TODAY - cd).days
        except:
            pass

    verbal_hca = r.get('Verbal HCA', '').strip() == 'true'
    days_mod = days_since(r.get('Modified Time', ''))
    cp_stage = r.get('CP Stage', '').strip()
    numeric_id = r.get('Record Id', '').strip().replace('zcrm_', '')
    owner = r.get('Consumer Owner', '').strip()
    owner_email = REP_EMAILS.get(owner, make_email(owner))

    gaps = []
    if not verbal_hca:
        gaps.append('No verbal HCA')
    if days_mod and days_mod > 7:
        gaps.append(f'{days_mod}d no activity')
    if closing_overdue and closing_overdue > 0:
        gaps.append(f'Closing {closing_overdue}d overdue')
    if cp_stage in ['0. New', '2. CP Drafted']:
        gaps.append(f'CP stuck: {cp_stage}')

    severity = (
        'critical' if (not verbal_hca and days_mod and days_mod > 14) else
        'warning' if len(gaps) >= 2 else
        'watch'
    )

    records.append({
        'id': numeric_id,
        'name': r.get('Consumer Name', '').strip(),
        'owner': owner,
        'owner_email': owner_email,
        'hcp': r.get('HCP Level', '').strip(),
        'financial': r.get('Financial Status', '').strip(),
        'verbal_hca': verbal_hca,
        'cp_stage': cp_stage,
        'days_inactive': days_mod,
        'closing_overdue': closing_overdue,
        'committed': r.get('Committed Date', '').strip(),
        'funding': r.get('Funding Status', '').strip(),
        'gaps': gaps,
        'severity': severity,
    })

order = {'critical': 0, 'warning': 1, 'watch': 2}
records.sort(key=lambda x: (order[x['severity']], -(x['days_inactive'] or 0)))

rep_map = {}
for r in records:
    o = r['owner']
    if o not in rep_map:
        rep_map[o] = {'total': 0, 'critical': 0, 'warning': 0, 'watch': 0,
                      'no_verbal': 0, 'overdue': 0, 'email': r['owner_email']}
    rep_map[o]['total'] += 1
    rep_map[o][r['severity']] += 1
    if not r['verbal_hca']:
        rep_map[o]['no_verbal'] += 1
    if r['closing_overdue']:
        rep_map[o]['overdue'] += 1

critical_count = sum(1 for r in records if r['severity'] == 'critical')
warning_count  = sum(1 for r in records if r['severity'] == 'warning')
no_verbal      = sum(1 for r in records if not r['verbal_hca'])
overdue        = sum(1 for r in records if r['closing_overdue'])

# Patch index.html with new data
html_path = Path(__file__).parent / 'index.html'
if not html_path.exists():
    print("ERROR: index.html not found. Run from the trilogy-care-dashboard directory.")
    sys.exit(1)

html = html_path.read_text(encoding='utf-8')

# Replace DATA and REPS JS variables
html = re.sub(r'const DATA = \[.*?\];', f'const DATA = {json.dumps(records)};', html, flags=re.DOTALL)
html = re.sub(r'const REPS = \{.*?\};', f'const REPS = {json.dumps(rep_map)};', html, flags=re.DOTALL)

# Replace metric display values
html = re.sub(r'(<div class="metric-val red">)\d+(</div>\s*<div class="metric-lbl">Critical)',
              rf'\g<1>{critical_count}\g<2>', html)
html = re.sub(r'(<div class="metric-val amber">)\d+(</div>\s*<div class="metric-lbl">Warning)',
              rf'\g<1>{warning_count}\g<2>', html)
html = re.sub(r'(<div class="metric-val red">)\d+(</div>\s*<div class="metric-lbl">No verbal)',
              rf'\g<1>{no_verbal}\g<2>', html)
html = re.sub(r'(<div class="metric-val red">)\d+(</div>\s*<div class="metric-lbl">Closing)',
              rf'\g<1>{overdue}\g<2>', html)

# Update export date chip
export_date = TODAY.strftime('%-d %b %Y')
html = re.sub(r'\d+ \w+ \d{4} · \d+ consumers',
              f'{export_date} · {len(records)} consumers', html)

html_path.write_text(html, encoding='utf-8')

print(f"""
✓ index.html updated
  Records:  {len(records)} total
  Critical: {critical_count}
  Warning:  {warning_count}
  No HCA:   {no_verbal}
  Overdue:  {overdue}
  Reps:     {len(rep_map)}

Next: git add index.html && git commit -m "Update data {export_date}" && git push
""")
