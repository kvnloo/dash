import json, math, statistics, sys
from pathlib import Path
from collections import Counter, defaultdict
root=Path(sys.argv[1])
def specs(suite):
 for spec in suite.get('specs',[]):yield spec
 for child in suite.get('suites',[]):yield from specs(child)
def summaries(file):
 data=json.loads(file.read_text());tests=[t for s in data.get('suites',[]) for spec in specs(s) for t in spec.get('tests',[])]
 actual=Counter(t.get('results',[{}])[-1].get('status','not-started') if t.get('results') else 'not-started' for t in tests)
 return {'declared':data['stats'],'enumerated_tests':len(tests),'actual':dict(actual)}
bench={'scope':'Shared MBP, headed Chromium on private headless Sway. One sample per suite topology; not a controlled framework maximum.','sources':['https://playwright.dev/docs/test-parallel','https://playwright.dev/docs/browser-contexts','https://playwright.dev/docs/best-practices'],'numeric_doc_targets':None}
micro=root/'benchmark-micro.json'
if micro.exists():
 data=json.loads(micro.read_text());groups=defaultdict(list)
 for r in data['rows']:groups[r['name']].append(r['ms'])
 bench['micro']={k:{'n':len(v),'p50_ms':statistics.median(v),'p95_ms':sorted(v)[max(0,math.ceil(.95*len(v))-1)],'min_ms':min(v),'max_ms':max(v)} for k,v in groups.items()}
 bench['micro_scope']=data['scope'];bench['playwright_version']=data['playwrightVersion'];bench['browser']=data['browserRevision']
bench['suites']={}
for name in ['measured-one','measured-four','qualification-eight']:
 p=root/(name+'-wall.json')
 if p.exists():bench['suites'][name]=json.loads(p.read_text())
 p=root/(name+'.json')
 if p.exists():bench['suites'].setdefault(name,{})['counts']=summaries(p)
 p=root/(name+'-startup.json')
 if p.exists():
  data=json.loads(p.read_text());rows=data['rows'];bench['suites'].setdefault(name,{})['startup']={'discovery_ms':next((r['command_to_discovery_ms'] for r in rows if r['event']=='onBegin'),None),'first_test_ms':next((r['command_to_test_ms'] for r in rows if r['event']=='onTestBegin'),None)}
if all(n in bench['suites'] and 'wall_ms' in bench['suites'][n] for n in ['measured-one','measured-four']):
 one=bench['suites']['measured-one']['wall_ms'];four=bench['suites']['measured-four']['wall_ms'];bench['scaling']={'speedup_4_vs_1':one/four,'efficiency_4_vs_1':one/(4*four),'formula':'speedup=T1/T4; efficiency=T1/(4*T4)'}
actions=defaultdict(list)
for run in ['measured-one','measured-four']:
 for p in (root/run).glob('*/action-metrics.json'):
  for r in json.loads(p.read_text()):actions[run+': '+r['name']].append(r['ms'])
bench['dash_actions']={k:{'n':len(v),'p50_ms':statistics.median(v),'max_ms':max(v)} for k,v in actions.items()}
thermal={}
for run in ['measured-one','measured-four']:
 p=root/(run+'-telemetry.jsonl')
 if not p.exists():continue
 rows=[json.loads(l) for l in p.read_text().splitlines() if l.strip()];temps=[int(v)/1000 for r in rows for v in r['temp'].values()];keys=set(rows[0]['throttle'])&set(rows[-1]['throttle'])
 thermal[run]={'samples':len(rows),'temp_min_c':min(temps),'temp_max_c':max(temps),'load1_min':min(r['loadavg'][0] for r in rows),'load1_max':max(r['loadavg'][0] for r in rows),'throttle_counter_deltas':{k:int(rows[-1]['throttle'][k])-int(rows[0]['throttle'][k]) for k in keys}}
bench['thermal']=thermal
(root/'benchmark.json').write_text(json.dumps(bench,indent=2)+'\n')
print(json.dumps(bench,indent=2))
