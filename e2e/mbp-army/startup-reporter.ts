import type { Reporter, TestCase, TestResult, FullResult } from 'playwright/types/testReporter';
import {writeFileSync} from 'node:fs';
export default class StartupReporter implements Reporter {
 private rows: unknown[]=[];
 private start=Number(process.env.ARMY_COMMAND_STARTED || Date.now());
 onBegin(){this.rows.push({event:'onBegin',command_to_discovery_ms:Date.now()-this.start});}
 onTestBegin(test:TestCase,result:TestResult){this.rows.push({event:'onTestBegin',title:test.title,command_to_test_ms:Date.now()-this.start,worker:result.workerIndex});}
 onEnd(result:FullResult){if(process.env.ARMY_STARTUP)writeFileSync(process.env.ARMY_STARTUP,JSON.stringify({rows:this.rows,status:result.status,duration_ms:result.duration},null,2));}
}
