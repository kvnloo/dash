// Pure, cross-harness presentation. Redact before parsing AND before returning text.
export function redactTool(text: string): string {
  return text.replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,}|xox[baprs]-[\w-]{10,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[REDACTED]')
    .replace(/((?:["']?(?:[\w-]{0,64}(?:token|secret|password)|api[_-]?key|authorization)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}\n]+)/gi, '$1"[REDACTED]"')
    .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]');
}
export function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}; }
function parse(value: string): Record<string, unknown> { try { return object(JSON.parse(value)); } catch { return {}; } }
function json(value: string): boolean { try { JSON.parse(value); return true; } catch { return false; } }
// ACP (Hermes acp_adapter) reports results as "<tool> result\n- **key:** value" bullets, not JSON.
function bullets(text: string): Record<string, unknown> {
  const out: Record<string, string> = {}; let key = '';
  for (const line of text.split('\n')) {
    const match = /^- \*\*([\w-]+):\*\*\s?(.*)$/.exec(line);
    if (match?.[1]) { key = match[1]; out[key] = match[2] ?? ''; } else if (key) out[key] += `\n${line}`;
  }
  return out;
}
const short = (text: string, max = 100) => text.length <= max ? text : `${text.slice(0, Math.floor(max * .6))}…${text.slice(-Math.floor(max * .35))}`;
const str = (value: unknown): string => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
const first = (text: string) => text.trim().split('\n')[0] ?? '';
export interface FormatTool { name: string; args: string; output: string; status: string; durationMs: number; summary?: string }
export interface ToolDescription { title: string; detail: string; args: string; output: string; path?: string; diff?: string }
/** `text` is non-JSON argument text, e.g. ACP's "$ bun test". */
type Context = { a: Record<string, unknown>; r: Record<string, unknown>; output: string; name: string; text: string };
type Formatter = (c: Context) => { title: string; detail?: string; path?: string; diff?: string };
const pathOf = (a: Record<string, unknown>) => str(a.path ?? a.file_path ?? a.filePath ?? a.target_file);
const terminal: Formatter = ({ a, r, output, text }) => ({ title: short(first(Array.isArray(a.command) ? a.command.join(' ') : str(a.command ?? a.cmd ?? a.code ?? a.script ?? (text.replace(/^\$\s+/, '') || undefined)))), detail: [a.cwd ?? a.workdir ?? r.cwd, r.exit_code !== undefined ? `exit ${str(r.exit_code)}` : '', str(r.output ?? output).trimEnd().split('\n').slice(-2).join('\n')].filter(Boolean).join(' · ') });
const read: Formatter = ({ a }) => { const start = Number(a.offset ?? a.start_line ?? 1); const end = a.end_line ?? (a.limit ? start + Number(a.limit) - 1 : undefined); const path = pathOf(a); return { title: `${path}:${start}${end ? `–${str(end)}` : ''}`, path }; };
const write: Formatter = ({ a, r }) => ({ title: pathOf(a), path: str(r.resolved_path) || pathOf(a), detail: [r.bytes_written ?? r.file_size ?? r.bytes ?? new TextEncoder().encode(str(a.content ?? a.contents)).length, 'bytes', r.lint_result ?? object(r.lint).status ?? r.lint ?? (r.verified === true ? 'write verified' : '')].filter(x => x !== '').map(str).join(' ') });
const edit: Formatter = ({ a, r, output }) => { const old = str(a.old_string ?? a.oldText); const next = str(a.new_string ?? a.newText); const count = (s: string) => s ? s.split('\n').length : 0; const diff = old || next ? [...old.split('\n').filter(() => Boolean(old)).map(s => `-${s}`), ...next.split('\n').filter(() => Boolean(next)).map(s => `+${s}`)].join('\n') : str(r.diff ?? a.patch ?? a.input ?? output); return { title: pathOf(a) || /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(diff)?.[1] || first(diff), path: pathOf(a) || /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(diff)?.[1], detail: old || next ? `+${count(next)}/−${count(old)}` : `+${diff.split('\n').filter(s => s.startsWith('+') && !s.startsWith('+++')).length}/−${diff.split('\n').filter(s => s.startsWith('-') && !s.startsWith('---')).length}`, diff }; };
const search: Formatter = ({ a, r }) => ({ title: `${str(a.pattern ?? a.query ?? a.glob)} · ${str(a.path ?? a.target ?? '.')}`, detail: r.total_count !== undefined ? `${str(r.total_count)} matches` : Array.isArray(r.matches) ? `${r.matches.length} matches` : '' });
const task: Formatter = ({ a, r }) => ({ title: short(str(a.goal ?? a.prompt ?? a.description ?? a.tasks ?? a.task ?? a.action)), detail: [Array.isArray(a.tasks) ? `${a.tasks.length} tasks` : r.count !== undefined ? `${str(r.count)} tasks` : '', r.status ?? (Array.isArray(r.subagents) ? r.subagents.map(item => str(object(item).status)).join(', ') : '')].filter(Boolean).map(str).join(' · ') });
const todo: Formatter = ({ a, r }) => ({ title: short(str(a.action ?? a.todos ?? a.items ?? a.operations ?? a.task ?? a)), detail: str(r.status ?? r.message) });
const web: Formatter = ({ a }) => ({ title: str(a.query ?? a.search_query) });
const browser: Formatter = ({ a, name }) => ({ title: `${str(a.action ?? a.method ?? first(str(a.code)) ?? name)} ${str(a.url ?? a.uri ?? a.image_url)}`.trim() });
const fallback: Formatter = ({ a }) => ({ title: Object.entries(a).filter(([k]) => !/^(timeout|limit|session|background|offset)/.test(k)).sort(([k], [l]) => Number(/content|code|text/.test(k)) - Number(/content|code|text/.test(l))).slice(0, 2).map(([k, v]) => `${k}: ${short(str(v), 70)}`).join(' · ') });
const hermes: Record<string, Formatter> = {
  terminal, read_file: read, write_file: write, patch: edit, search_files: search,
  memory: ({ a }) => ({ title: `${str(a.action)} ${str(a.target)} · ${short(str(a.content ?? a.new_content ?? a.old_content), 60)}` }),
  skill_view: ({ a }) => ({ title: `${str(a.name)} · view${a.file_path ? ` · ${str(a.file_path)}` : ''}` }),
  skill_manage: ({ a }) => ({ title: Array.isArray(a.operations) ? a.operations.map(op => `${str(object(op).name)} · ${str(object(op).action)}`).join(', ') : `${str(a.name)} · ${str(a.action)}` }),
  delegate_task: task, web_search: web,
  web_extract: ({ a }) => ({ title: (Array.isArray(a.urls) ? a.urls : [a.url]).map(url => { try { return new URL(str(url)).hostname; } catch { return str(url); } }).join(', ') }),
  vision_analyze: ({ a }) => ({ title: `${str(a.image_url).split('/').at(-1)} · ${str(a.question)}` }),
  execute_code: ({ a }) => ({ title: first(str(a.code)).replace(/^#\s*/, '') }),
  clarify: ({ a }) => ({ title: str(a.question ?? a.questions) }), todo_list: todo, browser_exec: browser,
};
const aliases: Record<string, Formatter> = { bash: terminal, shell: terminal, Bash: terminal, read, Read: read, write, Write: write, edit, Edit: edit, apply_patch: edit, grep: search, Grep: search, find: search, Glob: search, task, Task: task, todo, WebFetch: browser };
export const toolFormatters: Record<string, Record<string, Formatter>> = { hermes, omp: aliases, pi: aliases, codex: aliases, claude: aliases };
export function formatTool(tool: FormatTool, harness = 'hermes'): ToolDescription {
  const name = tool.name.replace(/^functions\./, '');
  const a = parse(tool.args); let output = redactTool(tool.output);
  const path = pathOf(a);
  // An .env file is all secret values, even for innocently named assignments.
  if (/(^|\/)\.env(?:\.|$)/.test(path)) output = '[REDACTED .env values]';
  const r = json(output) ? parse(output) : bullets(output);
  const text = json(tool.args) ? '' : tool.args.trim();
  const formatter = toolFormatters[harness]?.[name] ?? hermes[name] ?? aliases[name] ?? (/^(?:mcp|browser)/.test(name) ? browser : fallback);
  const result = formatter({ a, r, output, name, text });
  const title = result.title || (tool.summary && tool.summary !== name ? tool.summary : '') || first(text) || name;
  let args: string;
  try { args = JSON.stringify(JSON.parse(tool.args), null, 2); } catch { args = tool.args; }
  if (/(^|\/)\.env(?:\.|$)/.test(path)) args = args.replace(/("(?:content|old_string|new_string)"\s*:\s*)"(?:\\.|[^"\\])*"/g, '$1"[REDACTED .env values]"');
  return { ...result, title: short(redactTool(title), 120), detail: redactTool([result.detail, `${tool.status} · ${(tool.durationMs / 1000).toFixed(1)}s`].filter(Boolean).join(' · ')), args: redactTool(args), output, ...(result.diff ? { diff: /(^|\/)\.env(?:\.|$)/.test(path) ? '[REDACTED .env values]' : redactTool(result.diff) } : {}) };
}
export function groupTools<T extends FormatTool>(tools: T[]): { tools: T[]; title: string }[] {
  const groups: { tools: T[]; title: string }[] = [];
  for (const tool of tools) { const last = groups.at(-1); if (last?.tools[0]?.name === tool.name) last.tools.push(tool); else groups.push({ tools: [tool], title: '' }); }
  for (const group of groups) {
    const tool = group.tools[0]; if (!tool) continue;
    const counts = new Map<string, number>();
    for (const item of group.tools) { const action = str(parse(item.args).action) || item.status; counts.set(action, (counts.get(action) ?? 0) + 1); }
    group.title = group.tools.length === 1 ? `${tool.name} · ${formatTool(tool).title}` : `${tool.name} ×${group.tools.length} · ${[...counts].map(([action, count]) => `${action} ${count}`).join(', ')}`;
  }
  return groups;
}
