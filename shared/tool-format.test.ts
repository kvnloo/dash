import { expect, test } from "bun:test";
import fixtures from "./fixtures/native-tools.json";
import { formatTool, groupTools, redactTool } from "./tool-format";
const base = { name: "terminal", args: '{}', output: '', status: 'ok', durationMs: 2000 };
for (const sample of fixtures) test(`recorded native ${sample.name}: useful bounded title and retained details`, () => {
  const f = formatTool(sample);
  expect(f.title.length).toBeGreaterThan(0); expect(f.title.length).toBeLessThanOrEqual(120);
  expect(f.args).toContain('{'); expect(f.detail).toContain('0.1s');
});
for (const [harness, names, args, expected] of [
  ['hermes', ['terminal'], {command:'bun test shared',workdir:'/repo'}, 'bun test shared'],
  ['omp', ['bash'], {command:'bun test shared'}, 'bun test shared'],
  ['pi', ['bash'], {command:'bun test shared'}, 'bun test shared'],
  ['codex', ['shell'], {command:['git','status']}, 'git status'],
  ['claude', ['Bash'], {command:'git status'}, 'git status'],
  ['hermes', ['read_file'], {path:'src/x.ts',offset:5,limit:10}, 'src/x.ts:5–14'],
  ['omp', ['read'], {path:'src/x.ts'}, 'src/x.ts:1'],
  ['pi', ['read'], {path:'src/x.ts'}, 'src/x.ts:1'],
  ['claude', ['Read'], {file_path:'src/x.ts'}, 'src/x.ts:1'],
  ['hermes', ['write_file'], {path:'src/x.ts',content:'hi'}, 'src/x.ts'],
  ['omp', ['write'], {path:'src/x.ts',content:'hi'}, 'src/x.ts'],
  ['pi', ['write'], {path:'src/x.ts',content:'hi'}, 'src/x.ts'],
  ['claude', ['Write'], {file_path:'src/x.ts',content:'hi'}, 'src/x.ts'],
  ['hermes', ['patch'], {path:'src/x.ts',old_string:'a',new_string:'b\nc'}, 'src/x.ts'],
  ['omp', ['edit'], {path:'src/x.ts',oldText:'a',newText:'b'}, 'src/x.ts'],
  ['pi', ['edit'], {path:'src/x.ts',oldText:'a',newText:'b'}, 'src/x.ts'],
  ['claude', ['Edit'], {file_path:'src/x.ts',old_string:'a',new_string:'b'}, 'src/x.ts'],
  ['codex', ['apply_patch'], {input:'*** Begin Patch\n*** Update File: src/x.ts\n-a\n+b\n*** End Patch'}, 'src/x.ts'],
  ['hermes', ['search_files'], {pattern:'hello',path:'src'}, 'hello · src'],
  ['omp', ['grep','find'], {pattern:'hello',path:'src'}, 'hello · src'],
  ['pi', ['grep','find'], {pattern:'hello',path:'src'}, 'hello · src'],
  ['claude', ['Grep','Glob'], {pattern:'hello',path:'src'}, 'hello · src'],
  ['hermes', ['memory'], {action:'add',target:'user',content:'Short memory'}, 'add user · Short memory'],
  ['hermes', ['skill_view'], {name:'loop'}, 'loop · view'],
  ['hermes', ['skill_manage'], {operations:[{name:'loop',action:'patch'}]}, 'loop · patch'],
  ['hermes', ['delegate_task'], {goal:'Check tests'}, 'Check tests'],
  ['omp', ['task'], {prompt:'Check tests'}, 'Check tests'],
  ['pi', ['task'], {prompt:'Check tests'}, 'Check tests'],
  ['claude', ['Task'], {prompt:'Check tests'}, 'Check tests'],
  ['hermes', ['web_search'], {query:'Expo tree'}, 'Expo tree'],
  ['hermes', ['web_extract'], {urls:['https://example.org/path']}, 'example.org'],
  ['hermes', ['browser','mcp__browser__navigate'], {action:'navigate',url:'https://example.org'}, 'navigate https://example.org'],
  ['claude', ['WebFetch'], {url:'https://example.org'}, 'https://example.org'],
  ['hermes', ['vision_analyze'], {image_url:'/repo/screen.png',question:'What changed?'}, 'screen.png · What changed?'],
  ['hermes', ['execute_code'], {code:'# Check the result\nprint(1)'}, 'Check the result'],
  ['hermes', ['clarify'], {question:'Continue?'}, 'Continue?'],
  ['hermes', ['todo_list'], {action:'update',items:[{status:'done'}]}, 'update'],
  ['omp', ['todo'], {action:'update'}, 'update'],
  ['pi', ['todo'], {action:'update'}, 'update'],
  ['hermes', ['unknown'], {path:'/repo',query:'needle',timeout:5}, 'path: /repo · query: needle'],
] as const) for (const name of names) test(`${harness}/${name} formatter contract (alias fixture, not native recording)`, () => {
  expect(formatTool({...base,name,args:JSON.stringify(args)},harness).title).toBe(expected);
});
test('terminal result tail, cwd, exit and duration', () => {
  const f = formatTool({...base,args:'{"command":"bun test","cwd":"/repo"}',output:JSON.stringify({exit_code:1,output:'first\nsecond\nerror: failed'})});
  expect(f.detail).toContain('/repo · exit 1 · second\nerror: failed'); expect(f.detail).not.toContain('first');
});
test('diff counts, bytes, match count', () => {
  expect(formatTool({...base,name:'patch',args:'{"path":"x","old_string":"a","new_string":"b\\nc"}'}).detail).toContain('+2/−1');
  expect(formatTool({...base,name:'write_file',args:'{"path":"x","content":"é"}'}).detail).toContain('2 bytes');
  expect(formatTool({...base,name:'search_files',output:'{"total_count":42}'}).detail).toContain('42 matches');
});
test('only consecutive identical calls group, preserving identities', () => {
  const memory = (action: string) => ({...base,name:'memory',args:JSON.stringify({action})});
  const groups = groupTools([memory('add'),memory('add'),memory('replace'),base,memory('add')]);
  expect(groups.map(g=>g.tools.length)).toEqual([3,1,1]); expect(groups[0]?.title).toBe('memory ×3 · add 2, replace 1');
});
test('redacts args, title, nested output, Authorization and .env values', () => {
  const secret = 'sk-abcdefghijklmnop';
  const f = formatTool({...base,args:JSON.stringify({command:`curl -H 'Authorization: Bearer ${secret}'`,token:secret}),output:JSON.stringify({nested:{api_key:secret}})});
  expect(JSON.stringify(f)).not.toContain(secret);
  expect(redactTool('Authorization: Bearer secret-value')).not.toContain('secret-value');
  const env = formatTool({...base,name:'read_file',args:'{"path":"/repo/.env"}',output:'NORMAL_NAME=private-value\nexport SOMETHING=another-value'});
  expect(env.output).not.toContain('private-value'); expect(env.output).not.toContain('another-value');
  const write = formatTool({...base,name:'write_file',args:JSON.stringify({path:'/repo/.env',content:'NORMAL=private-value'})});
  expect(JSON.stringify(write)).not.toContain('private-value');
});
test('ACP plain "$ command" terminal args keep command identity and exit status', () => {
  const f = formatTool({...base,args:'$ bun test parser.test.ts',output:'terminal result\n- **output:** 1 fail\n- **exit_code:** 1',status:'error'});
  expect(f.title).toBe('bun test parser.test.ts');
  expect(f.detail).toContain('exit 1');
  expect(f.detail).toContain('1 fail');
});
test('retained summary is the title fallback before the bare tool name', () => {
  expect(formatTool({...base,name:'mystery',args:'not json',summary:'inspect roster'}).title).toBe('inspect roster');
  expect(formatTool({...base,name:'mystery',args:'',summary:'mystery'}).title).toBe('mystery');
});
test('plain-text terminal args are redacted in title and args', () => {
  const f = formatTool({...base,args:"$ curl -H 'Authorization: Bearer abcdef123456' --data token=hunter2-secret"});
  expect(JSON.stringify(f)).not.toContain('abcdef123456'); expect(JSON.stringify(f)).not.toContain('hunter2-secret');
  expect(f.title).toStartWith('curl -H');
});
