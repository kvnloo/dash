// Stand-in for `launchctl` and `systemctl --user` in onboarding journeys. It reads the service file
// scripts/onboard.ts wrote and starts its program the way the real manager would: only the file's
// environment, working directory and log paths, detached in its own process group. Nothing else.
//   bun fixture-service-manager.ts launchctl bootstrap gui/<uid> <plist> | bootout gui/<uid>/<label> | print gui/<uid>/<label>
//   bun fixture-service-manager.ts systemctl --user daemon-reload | enable <unit> | restart <unit> | disable --now <unit> | is-active <unit>
//   bun fixture-service-manager.ts plutil -lint <plist> | plutil -convert json -o - <plist>
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Program = { args: string[]; cwd: string; env: Record<string,string>; log: string };
const home = process.env.HOME || '.';
const state = join(home, '.army-services');
mkdirSync(state, { recursive: true });
const [tool = '', ...args] = process.argv.slice(2);
appendFileSync(join(state, 'calls.log'), [tool, ...args].join(' ') + '\n');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function plist(file: string): Record<string, unknown> {
 // A real plist parser: anything launchd would reject fails here too.
 const json: unknown = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', file], { encoding: 'utf8' }));
 if (!isRecord(json)) throw Error('plist root is not a dict');
 return json;
}

function launchdProgram(file: string): { label: string; program: Program } {
 const p = plist(file);
 const env: Record<string,string> = {};
 if (isRecord(p.EnvironmentVariables)) for (const [k, v] of Object.entries(p.EnvironmentVariables)) if (typeof v === 'string') env[k] = v;
 const label = typeof p.Label === 'string' ? p.Label : '';
 const args = strings(p.ProgramArguments);
 if (!label || !args.length || typeof p.WorkingDirectory !== 'string' || typeof p.StandardOutPath !== 'string') throw Error('incomplete launchd plist ' + file);
 return { label, program: { args, cwd: p.WorkingDirectory, env, log: p.StandardOutPath } };
}

/** systemd's quoting for the subset onboard writes: double-quoted words with backslash escapes, `%%`. */
function words(line: string): string[] {
 const out: string[] = [];
 const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
 for (const m of line.matchAll(re)) out.push((m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? '').replaceAll('%%', '%'));
 return out;
}

function systemdProgram(unit: string): Program {
 const dir = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user');
 const text = readFileSync(join(dir, unit), 'utf8');
 const env: Record<string,string> = {};
 let args: string[] = [], cwd = '', log = '';
 for (const line of text.split('\n')) {
  const at = line.indexOf('='); if (at < 0) continue;
  const key = line.slice(0, at), value = line.slice(at + 1);
  if (key === 'Environment') for (const w of words(value)) { const eq = w.indexOf('='); if (eq > 0) env[w.slice(0, eq)] = w.slice(eq + 1); }
  if (key === 'ExecStart') args = words(value);
  if (key === 'WorkingDirectory') cwd = value;
  if (key === 'StandardOutput' && value.startsWith('append:')) log = value.slice('append:'.length);
 }
 if (!args.length || !cwd || !log) throw Error('incomplete systemd unit ' + unit);
 return { args, cwd, env, log };
}

const pidFile = (name: string) => join(state, name + '.pid');
function alive(name: string): boolean {
 if (!existsSync(pidFile(name))) return false;
 try { process.kill(Number(readFileSync(pidFile(name), 'utf8')), 0); return true; } catch { return false; }
}
function start(name: string, p: Program): void {
 if (alive(name)) return;
 const fd = openSync(p.log, 'a');
 const child = spawn(p.args[0] ?? '', p.args.slice(1), { cwd: p.cwd, env: p.env, detached: true, stdio: ['ignore', fd, fd] });
 writeFileSync(pidFile(name), String(child.pid));
 child.unref();
}
async function stop(name: string): Promise<boolean> {
 if (!existsSync(pidFile(name))) return false;
 const pid = Number(readFileSync(pidFile(name), 'utf8'));
 const group = (signal: NodeJS.Signals) => { try { process.kill(-pid, signal); } catch { /* already gone */ } };
 group('SIGTERM');
 for (let i = 0; i < 100 && alive(name); i++) await new Promise(r => setTimeout(r, 100));
 group('SIGKILL');
 rmSync(pidFile(name), { force: true });
 return true;
}

const lastPart = (target: string) => target.split('/').pop() ?? '';
async function main(): Promise<number> {
 if (tool === 'plutil') {
  if (args[0] === '-lint' && args[1]) { plist(args[1]); return 0; }
  if (args[0] === '-convert' && args[1] === 'json' && args[2] === '-o' && args[3] === '-' && args[4]) { process.stdout.write(JSON.stringify(plist(args[4]))); return 0; }
  return 64;
 }
 if (tool === 'launchctl') {
  const [verb, domain = '', file = ''] = args;
  if (verb === 'bootstrap') { const { label, program } = launchdProgram(file); if (alive(label)) return 5; start(label, program); return 0; }
  if (verb === 'bootout') return (await stop(lastPart(domain))) ? 0 : 3;
  if (verb === 'print') return alive(lastPart(domain)) ? 0 : 113;
  return 64;
 }
 if (tool === 'systemctl') {
  const rest = args.filter(a => a !== '--user' && a !== '--now');
  const [verb, unit = ''] = rest;
  if (args[0] !== '--user') return 64;
  if (verb === 'daemon-reload' || verb === 'enable') return 0;
  if (verb === 'restart' || verb === 'start') { if (verb === 'restart') await stop(unit); start(unit, systemdProgram(unit)); return 0; }
  if (verb === 'disable' || verb === 'stop') { await stop(unit); return 0; }
  if (verb === 'is-active') return alive(unit) ? 0 : 3;
  return 64;
 }
 return 64;
}
process.exit(await main());
