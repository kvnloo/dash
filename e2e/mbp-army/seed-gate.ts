export {};
const { GateStore } = await import(process.env.ARMY_BRIDGE_ROOT + '/bridge/src/gate/store.ts');
const store = new GateStore(process.env.DASH_GATE_DIR);
await store.propose({kind:'issue_comment',target:{repo:'example/army-fixture',number:1},body:'ARMY_APPROVAL_FIXTURE: deterministic dry-run proposal',evidence:[{label:'fixture',url_or_path:'https://example.invalid/fixture'}],origin:{agent:'army-fixture',session:'isolated',created_at:new Date().toISOString()}},[{path:'CONTRIBUTING.md',text:'Tests and clear reproduction are required.'}]);

if(process.env.ARMY_PERSIST_SESSION==='1'){
 const {Database}=await import('bun:sqlite');const {join}=await import('node:path');
 const home=process.env.HERMES_HOME;if(!home)throw Error('isolated Hermes home required');
 const db=new Database(join(home,'state.db'));
 db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT)');
 db.query('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('army-fixture-session','acp','ARMY native fixture',Date.now()/1000,Date.now()/1000,0,process.env.DASH_CWD || home,0,0,null,null,'{}');db.close();
}

// A long native Hermes chat: user and assistant rows one minute apart, the last one now, as Hermes writes
// them (one answer per prompt). The ws window and the paged /chats/history both read these rows.
if(process.env.ARMY_LONG_HERMES){
 const {Database}=await import('bun:sqlite');const {join}=await import('node:path');
 const home=process.env.HERMES_HOME;if(!home)throw Error('isolated Hermes home required');
 const prompts=Number(process.env.ARMY_LONG_HERMES);const id='army-long-hermes';const now=Date.now()/1000;
 const db=new Database(join(home,'state.db'));
 db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT)');
 db.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,role TEXT,content TEXT,timestamp REAL,reasoning TEXT,reasoning_content TEXT,tool_calls TEXT,tool_call_id TEXT,is_error INTEGER,active INTEGER DEFAULT 1)');
 db.query('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'acp','ARMY long Hermes chat',now-prompts*120,now-60,prompts*2,process.env.DASH_CWD||home,0,0,null,null,'{}');
 const insert=db.query('INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?,?,?,?,1)');
 db.transaction(()=>{for(let n=1;n<=prompts;n++){
  const label=String(n).padStart(3,'0');const t=now-(prompts*2-(n*2-1))*60;
  insert.run(id,'user','ARMY hermes prompt '+label,t);
  insert.run(id,'assistant','ARMY hermes answer '+label+' '+'detail '.repeat(5+(n*37)%300),t+60);
 }})();
 db.close();
}

// AgentsView archive rows (the bridge indexes them on boot). Self: the install id names this
// computer. Remote: a session synced from `army-remote`, id prefixed `<machine>~` like AgentsView.
async function seedAgentsview(row:{id:string;machine:string;title:string;cwd:string;installId?:string;transcript?:[string,string][]}){
 const {Database}=await import('bun:sqlite');const {join}=await import('node:path');const {mkdirSync,writeFileSync}=await import('node:fs');
 const home=process.env.HOME;if(!home||!home.includes('dash-army-'))throw Error('isolated HOME required');
 const dir=join(home,'.agentsview');mkdirSync(dir,{recursive:true});
 if(row.installId)writeFileSync(join(dir,'telemetry-install-id'),row.installId+'\n');
 const db=new Database(join(dir,'sessions.db'));
 db.exec(`create table if not exists sessions (id text primary key, project text not null default '', machine text not null default 'local', agent text not null default 'claude',
  entrypoint text not null default '', session_kind text not null default '', first_message text, display_name text, session_name text,
  started_at text, ended_at text, message_count integer not null default 0, user_message_count integer not null default 0,
  parent_session_id text, deleted_at text, is_automated integer not null default 0, cwd text not null default '');
  create index if not exists idx_sessions_ended on sessions(ended_at desc, id);
  create table if not exists messages (id integer primary key, session_id text not null, ordinal integer not null, role text not null, content text not null,
  timestamp text, content_length integer not null default 0, is_system integer not null default 0, unique(session_id, ordinal));
  create virtual table if not exists messages_fts using fts5(content, content='messages', content_rowid='id', tokenize='porter unicode61');
  create trigger if not exists messages_ai after insert on messages begin insert into messages_fts(rowid, content) values (new.id, new.content); end;`);
 const now=Date.now();const at=(m:number)=>new Date(now-m*60000).toISOString();
 db.query('insert into sessions (id, project, machine, agent, first_message, started_at, ended_at, message_count, user_message_count, cwd) values (?,?,?,?,?,?,?,?,?,?)')
  .run(row.id,'army',row.machine,'claude',row.title,at(row.transcript?row.transcript.length:30),at(1),row.transcript?row.transcript.length:12,row.transcript?row.transcript.filter(([role])=>role==='user').length:3,row.cwd);
 const msgs:[string,string][]=row.transcript??[['user',row.title],['assistant','ARMY earlier answer from '+row.machine]];
 // A seeded transcript is one minute per row, ending a minute ago; the default pair keeps its spacing.
 const stamp=(i:number)=>row.transcript?at(msgs.length-i):at(20-i);
 db.transaction(()=>msgs.forEach(([role,content],i)=>db.query('insert into messages (session_id, ordinal, role, content, timestamp, content_length) values (?,?,?,?,?,?)').run(row.id,i,role,content,stamp(i),content.length)))();
 db.close();
}
if(process.env.ARMY_ARCHIVE_CLAUDE==='1'){
 const installId='a1b2c3d4e5f60718293a4b5c6d7e8f90';
 await seedAgentsview({id:'11111111-2222-4333-8444-555555555555',machine:installId,installId,title:'ARMY archived Claude Code chat',cwd:process.env.DASH_CWD||''});
}
if(process.env.ARMY_LONG_CLAUDE){
 // A long chat as Hermes and Claude Code write them: every prompt is followed by several tool-step
 // rows and one final answer, so the newest 50 rows (the first page) hold only a handful of prompts.
 const installId='a1b2c3d4e5f60718293a4b5c6d7e8f90';
 const prompts=Number(process.env.ARMY_LONG_CLAUDE);const steps=6;
 const transcript:[string,string][]=[];
 for(let n=1;n<=prompts;n++){
  const label=String(n).padStart(3,'0');
  transcript.push(['user','ARMY prompt '+label]);
  for(let k=1;k<=steps;k++)transcript.push(['assistant','ARMY tool step '+k+' of prompt '+label]);
  // Answer volume varies so tick widths vary: 40 to ~5000 characters.
  transcript.push(['assistant','ARMY answer '+label+' '+'detail '.repeat(5+(n*37)%700)]);
 }
 await seedAgentsview({id:'33333333-4444-4555-8666-777777777777',machine:installId,installId,title:'ARMY long Claude Code chat',cwd:process.env.DASH_CWD||'',transcript});
}
if(process.env.ARMY_REMOTE_CLAUDE){
 await seedAgentsview({id:'army-remote~22222222-3333-4444-8555-666666666666',machine:'army-remote',title:'ARMY remote Claude Code chat',cwd:process.env.ARMY_REMOTE_CLAUDE});
}

// /pm: a repository ledger in the _pm format (shared/pm.ts), the Hermes board and the roadmap file.
if(process.env.ARMY_PM==='1'){
 const {join}=await import('node:path');const {mkdirSync,writeFileSync}=await import('node:fs');
 const home=process.env.HOME;if(!home||!home.includes('dash-army-'))throw Error('isolated HOME required');
 const ids:Record<string,number>={project:4,feature:5,task:6};
 const rows:unknown[]=[];let seq=0;
 const ev=(kind:string,subject:string,payload:Record<string,unknown>)=>rows.push({v:1,source:'dash-pm',kind,subject:'issue:'+subject,causation:'army-seed',seq:++seq,ts_ns:1_700_000_000_000_000_000+seq*1_000_000,payload});
 const issue=(id:string,type:string,title:string,parent?:string)=>ev('issue.created',id,{id,kind:ids[type],type,parent:parent??null,title});
 issue('army','project','Army Project');
 issue('army/alpha','feature','Feature Alpha','army');
 issue('army/beta','feature','Feature Beta','army');
 issue('army/alpha/one','task','ARMY task one','army/alpha');
 ev('issue.updated','army/alpha/one',{id:'army/alpha/one',set:{priority:'P0',assignee:'clean',hermes:'t_0000a1aa',evidence:'ARMY evidence one',next:'ARMY next one'}});
 issue('army/alpha/two','task','ARMY task two','army/alpha');
 ev('issue.state','army/alpha/two',{id:'army/alpha/two',from:'todo',to:'done'});
 issue('army/beta/three','task','ARMY task three','army/beta');
 ev('issue.updated','army/beta/three',{id:'army/beta/three',set:{priority:'P1',progress:40,evidence:'ARMY ledger evidence three',next:'ARMY ledger next three',pr:'https://github.com/kvnloo/dash/pull/123',assignee:'kevin',roadmap:'r1'}});
 ev('issue.state','army/beta/three',{id:'army/beta/three',from:'todo',to:'blocked'});
 issue('army/beta/four','task','ARMY task four waits on you','army/beta');
 ev('issue.updated','army/beta/four',{id:'army/beta/four',set:{attention:'you',next:'ARMY decide four'}});
 issue('second','project','Second Project');
 issue('second/gamma','feature','Feature Gamma','second');
 issue('second/gamma/five','task','ARMY task five','second/gamma');
 rows.push('{"this line": "is not a ledger row"');
 mkdirSync(join(home,'pm-repo','pm'),{recursive:true});
 writeFileSync(join(home,'pm-repo','pm','events.jsonl'),rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n');
 writeFileSync(join(home,'kanban.json'),JSON.stringify([{id:'t_0000a1aa',status:'running',assignee:'clean',title:'ARMY card'},{id:'t_ffffffff',status:'done',assignee:'other',title:'unrelated'}]));
 writeFileSync(join(home,'roadmap.json'),JSON.stringify({id:'dash-roadmap',title:'Dash roadmap',updated:'',items:[{id:'r1',title:'ARMY roadmap item',stage:'candidate',area:'',detail:'',evidence:'ARMY LIVE roadmap evidence',next:'ARMY LIVE roadmap next',progress:70}]}));
}
