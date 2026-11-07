import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decodeCursor, encodeCursor, MESSAGE_TEXT_MAX, parseServerMessage, type HistoryPage } from "../../shared/protocol";
import { redact } from "./reply-parts";
import { remoteShellCommand, type RemoteHost } from "./remote-hosts";

const exec = promisify(execFile);
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
// Seek only the requested tail window. Byte offsets stay stable when another process appends.
// Ignore an incomplete final line; the next foreground poll will observe its completed record.
const reader = `import glob,json,os,sys
sid,end,limit=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
paths=glob.glob(os.path.expanduser('~/.claude/projects/*/'+sid+'.jsonl'))
if len(paths)!=1: sys.exit(1)
with open(paths[0],'rb') as f:
 size=os.fstat(f.fileno()).st_size
 end=size if end<0 else min(end,size)
 start=max(0,end-2*1024*1024)
 f.seek(start)
 data=f.read(end-start)
pos=start
if start:
 cut=data.find(b'\\n')
 if cut<0: sys.exit(1)
 pos+=cut+1; data=data[cut+1:]
window_start=pos
rows=[]
for line in data.splitlines(keepends=True):
 offset=pos; pos+=len(line)
 if not line.endswith(b'\\n'): break
 try: r=json.loads(line)
 except (ValueError,UnicodeError): continue
 m=r.get('message',{})
 role=m.get('role')
 if role not in ('user','assistant') or r.get('isMeta'): continue
 content=m.get('content',[])
 text=content if isinstance(content,str) else '\\n'.join(b.get('text','') for b in content if isinstance(b,dict) and b.get('type')=='text')
 if text: rows.append(dict(id='remote:'+str(offset),role=role,text=text,at=r.get('timestamp',''),offset=offset))
more=len(rows)>limit or start>0
rows=rows[-limit:]
while len(json.dumps(rows,ensure_ascii=False).encode('utf8'))>480*1024:
 if len(rows)<=1: sys.exit(1)
 rows=rows[1:]; more=True
before=rows[0]['offset'] if rows and more else (window_start if start else None)
print(json.dumps(dict(rows=rows,before=before),ensure_ascii=False))
`;

/** Any transport, size, timeout, missing-file or parse failure leaves the archive usable. */
export async function remoteClaudeHistory(host: RemoteHost, session: string, limit: number, before?: string): Promise<HistoryPage | undefined> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) return undefined;
  const cursor = before ? decodeCursor(before) : undefined;
  if (before && (!cursor || cursor.remote !== host.hostId || cursor.session !== session || typeof cursor.offset !== "number" || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)) return undefined;
  const end = cursor?.offset ?? -1;
  const count = Math.max(1, Math.min(200, limit));
  const [bin, ...args] = remoteShellCommand(host, `python3 -c ${quote(reader)} ${quote(session)} ${end} ${count}`);
  if (!bin) return undefined;
  try {
    const { stdout } = await exec(bin, args, { timeout: 5000, maxBuffer: 512 * 1024, killSignal: "SIGKILL" });
    const raw: unknown = JSON.parse(stdout);
    if (typeof raw !== "object" || raw === null || !("rows" in raw) || !Array.isArray(raw.rows) || !("before" in raw)) return undefined;
    const messages = [];
    const rows: unknown[] = raw.rows;
    for (const row of rows) {
      if (typeof row !== "object" || row === null || !("text" in row) || !("at" in row) || !("id" in row) || !("role" in row) || typeof row.text !== "string" || typeof row.at !== "string") return undefined;
      const text = redact(row.text);
      messages.push({ id: row.id, role: row.role, text: text.slice(0, MESSAGE_TEXT_MAX), at: Date.parse(row.at) || 0, ...(text.length > MESSAGE_TEXT_MAX ? { truncated: true } : {}) });
    }
    const parsed = parseServerMessage({ type: "history", harness: "claude", sessionId: session, messages });
    if (parsed?.type !== "history") return undefined;
    if (raw.before !== null && (typeof raw.before !== "number" || !Number.isSafeInteger(raw.before) || raw.before < 0)) return undefined;
    return { messages: parsed.messages, before: raw.before === null ? null : encodeCursor({ v: 1, remote: host.hostId, session, offset: raw.before }) };
  } catch { return undefined; }
}
