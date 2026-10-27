import subprocess, os, sys, time, json, threading
from pathlib import Path
base=Path.home()/'dash-e2e-army-20261025'
if not (base/'virtual-runtime/wayland-1').exists():raise SystemExit('Virtual display missing; never fall back to physical display')
name=sys.argv[1]; workers=sys.argv[2]; extra=sys.argv[3:]
env={**os.environ,'TMPDIR':str(base/'tmp'),'ARMY_TMP':str(base/'tmp'),'WAYLAND_DISPLAY':'wayland-1','XDG_RUNTIME_DIR':str(base/'virtual-runtime'),'ARMY_OUTPUT':str(base/name),'ARMY_HTML':str(base/(name+'-html')),'ARMY_JSON':str(base/(name+'.json')),'ARMY_SLOWMO':'0','ARMY_COMMAND_STARTED':str(time.time()*1000),'ARMY_STARTUP':str(base/(name+'-startup.json'))}
cmd=['node','node_modules/playwright/cli.js','test','-c','e2e/mbp-army/playwright.config.ts','--workers='+workers,'--headed',*extra]
def sample():
 while not stopped.is_set():
  row={'at':time.time(),'loadavg':os.getloadavg(),'meminfo':Path('/proc/meminfo').read_text(),'temp':{str(p):p.read_text().strip() for p in Path('/sys/class/thermal').glob('thermal_zone*/temp')},'throttle':{str(p):p.read_text().strip() for p in Path('/sys/devices/system/cpu').glob('cpu*/thermal_throttle/*throttle_count')}}
  with (base/(name+'-telemetry.jsonl')).open('a') as f:f.write(json.dumps(row)+'\n')
  stopped.wait(10)
stopped=threading.Event()
thread=threading.Thread(target=sample,daemon=True);thread.start()
t=time.perf_counter()
with (base/(name+'.log')).open('w') as f:
 p=subprocess.run(cmd,cwd=base/'repo',env=env,stdout=f,stderr=subprocess.STDOUT)
stopped.set();thread.join()
(base/(name+'-wall.json')).write_text(json.dumps({'run':name,'workers':int(workers),'wall_ms':(time.perf_counter()-t)*1000,'exit_code':p.returncode,'command':cmd},indent=2))
print(name,p.returncode)
