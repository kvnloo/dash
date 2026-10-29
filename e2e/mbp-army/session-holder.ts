// Fixture-only discoverable OMP session, confined to the bridge PID namespace.
import {existsSync,mkdirSync,openSync,writeSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const wait=process.env.ARMY_SESSION_HOLDER_WAIT;
if(wait)while(!existsSync(wait))await new Promise(resolve=>setTimeout(resolve,50));
// Bun's process.title does not update Linux comm; roster discovery reads comm.
writeFileSync('/proc/self/comm','omp');
const root=process.env.PI_CODING_AGENT_DIR;if(!root)throw Error('isolated OMP root required');
const dir=join(root,'sessions','army-fixture');mkdirSync(dir,{recursive:true});
const fd=openSync(join(dir,'fixture_army-fixture-session.jsonl'),'a+');
writeSync(fd,JSON.stringify({type:'session',id:'army-fixture-session'})+'\n');
const label=process.argv[2];
if(label==='secondary'&&process.env.ARMY_SECONDARY_CWD==='1'){
 const cwd=join(root,'army-secondary-cwd');mkdirSync(cwd,{recursive:true});process.chdir(cwd);
}
const control=label?`army-holder-${label}`:'army-holder';
writeFileSync(join(root,control+'.pid'),String(process.pid));
setInterval(()=>{
 if(process.env.ARMY_DUPLICATE_SESSION==='1'&&existsSync(join(root,control+'.stop')))process.exit(0);
},process.env.ARMY_DUPLICATE_SESSION==='1'?50:10000);
