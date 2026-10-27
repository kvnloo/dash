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
