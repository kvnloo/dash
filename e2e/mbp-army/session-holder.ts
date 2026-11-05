// Fixture-only discoverable OMP session, confined to the bridge PID namespace.
import {mkdirSync,openSync,writeSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Bun's process.title does not update Linux comm; roster discovery reads comm.
writeFileSync('/proc/self/comm','omp');
const root=process.env.PI_CODING_AGENT_DIR;if(!root)throw Error('isolated OMP root required');
const dir=join(root,'sessions','army-fixture');mkdirSync(dir,{recursive:true});
const fd=openSync(join(dir,'fixture_army-fixture-session.jsonl'),'a+');
writeSync(fd,JSON.stringify({type:'session',id:'army-fixture-session'})+'\n');
writeFileSync(join(root,'army-holder.pid'),String(process.pid));
setInterval(()=>{},10000);
