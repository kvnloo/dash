// The Roadmap screen: projects, features and tasks tracked in git (pm/events.jsonl, the _pm ledger
// format) with live status from the Hermes board and the roadmap file. Real Expo web UI -> isolated
// real bridge (GET /pm) -> a fixture repository ledger, board command and roadmap file.
import {test,expect,pair} from './fixtures';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

type Scope=import('playwright/test').Page|import('playwright/test').Locator;
// Native-stack keeps covered screens mounted (hidden): scope every lookup to the screen in front.
const task=(scope:Scope,id:string)=>scope.getByTestId(`pm-task-${id}`);
const fact=(page:import('playwright/test').Page,id:string)=>page.getByTestId('pm-task-detail').getByTestId(`pm-fact-${id}`);

test.describe('Roadmap from the repositories\' pm ledgers',()=>{
 test.use({bridgeOptions:{pm:true}});
 test('Roadmap -> project -> feature filter -> task detail with live Hermes and roadmap status',async({page,bridge},info)=>{
  await pair(page,bridge);
  // One tap from the main screen.
  await page.getByRole('button',{name:'Open roadmap',exact:true}).first().click({noWaitAfter:true});
  const home=page.getByTestId('roadmap-screen');
  await expect(home).toBeVisible();
  await expect(home.getByRole('heading',{name:'Waiting on you, 1'})).toBeVisible();
  await expect(task(home,'army/beta/four')).toBeVisible();
  await expect(home.getByRole('heading',{name:'Running now, 1'})).toBeVisible();
  await expect(task(home,'army/alpha/one')).toContainText('Hermes running');
  await expect(page.getByTestId('pm-project-army')).toHaveAttribute('aria-label','Army Project, 1 of 4 tasks done');
  await expect(page.getByTestId('pm-project-second')).toBeVisible();
  await expect(page.getByTestId('pm-ledger-errors')).toContainText('1 ledger line skipped');
  await page.screenshot({path:info.outputPath('roadmap-home.png')});

  await page.getByTestId('pm-project-army').click({noWaitAfter:true});
  const project=page.getByTestId('roadmap-project');
  await expect(project).toBeVisible();
  await expect(page.getByTestId('pm-feature-all')).toHaveAttribute('aria-selected','true');
  await expect(page.getByTestId('pm-feature-army/alpha')).toHaveAttribute('aria-label','Feature Feature Alpha, 2 tasks');
  for(const id of ['army/alpha/one','army/alpha/two','army/beta/three','army/beta/four']) await expect(task(project,id)).toBeVisible();
  await expect(task(project,'second/gamma/five')).toHaveCount(0);

  // Filter by feature: every task of Feature Beta, nothing else.
  await page.getByTestId('pm-feature-army/beta').click({noWaitAfter:true});
  await expect(page.getByTestId('pm-feature-army/beta')).toHaveAttribute('aria-selected','true');
  await expect(task(project,'army/beta/three')).toBeVisible();
  await expect(task(project,'army/beta/four')).toBeVisible();
  await expect(task(project,'army/alpha/one')).toHaveCount(0);
  await expect(task(project,'army/alpha/two')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('roadmap-feature-filter.png')});

  // Task detail: ledger facts, the PR, and the roadmap file's live progress/evidence/next.
  await task(project,'army/beta/three').click({noWaitAfter:true});
  const detail=page.getByTestId('pm-task-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading',{name:'ARMY task three'})).toBeVisible();
  await expect(fact(page,'status')).toHaveAttribute('aria-label','Status: Blocked');
  await expect(fact(page,'progress')).toHaveAttribute('aria-label','Progress: 70%');
  await expect(fact(page,'evidence')).toHaveAttribute('aria-label','Evidence: ARMY LIVE roadmap evidence');
  await expect(fact(page,'next')).toHaveAttribute('aria-label','Next: ARMY LIVE roadmap next');
  await expect(fact(page,'assignee')).toHaveAttribute('aria-label','Assignee: kevin');
  await expect(fact(page,'pr')).toHaveAttribute('aria-label','Open pull request https://github.com/kvnloo/dash/pull/123');
  await expect(fact(page,'source')).toContainText('live: roadmap file');
  await expect(detail.getByText('Army Project  ›  Feature Beta')).toBeVisible();
  await page.screenshot({path:info.outputPath('roadmap-task-detail.png')});

  // Back keeps the filter; another feature's task shows its running Hermes card.
  await page.getByRole('button',{name:'Back',exact:true}).click({noWaitAfter:true});
  await expect(page.getByTestId('pm-feature-army/beta')).toHaveAttribute('aria-selected','true');
  await page.getByTestId('pm-feature-army/alpha').click({noWaitAfter:true});
  await expect(task(project,'army/alpha/two')).toBeVisible();
  await task(project,'army/alpha/one').click({noWaitAfter:true});
  await expect(fact(page,'hermes')).toHaveAttribute('aria-label','Hermes kanban: t_0000a1aa · running · clean');
  await expect(fact(page,'status')).toHaveAttribute('aria-label','Status: Running');
  await expect(fact(page,'evidence')).toHaveAttribute('aria-label','Evidence: ARMY evidence one');
  await expect(fact(page,'next')).toHaveAttribute('aria-label','Next: ARMY next one');
  await expect(fact(page,'source')).toContainText('live: Hermes board');
  await page.screenshot({path:info.outputPath('roadmap-hermes-task.png')});

  // The same document over HTTP: authenticated, live board, the bad ledger line reported, not fatal.
  const token=(await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim();
  expect((await fetch(`http://127.0.0.1:${bridge.port}/pm`)).status).toBe(401);
  const doc=await (await fetch(`http://127.0.0.1:${bridge.port}/pm`,{headers:{Authorization:`Bearer ${token}`}})).json();
  expect(doc.kanban).toBe('live');
  expect(doc.repos).toEqual([{repo:'army',issues:10,errors:[expect.stringContaining('pm/events.jsonl:16: not JSON')]}]);
 });
});

test('the Dash repository\'s own pm ledger parses cleanly and tracks the Hermes tasks',async({bridge})=>{
 const token=(await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim();
 const doc=await (await fetch(`http://127.0.0.1:${bridge.port}/pm`,{headers:{Authorization:`Bearer ${token}`}})).json();
 expect(doc.repos).toEqual([{repo:'dash',issues:expect.any(Number),errors:[]}]);
 const issues:{id:string;type:string;hermes?:string;parent?:string}[]=doc.issues;
 expect(issues.find(i=>i.id==='dash')?.type).toBe('project');
 const byId=new Map(issues.map(i=>[i.id,i]));
 for(const i of issues) if(i.parent) expect(byId.has(i.parent)).toBe(true);
 expect(issues.filter(i=>i.type==='feature'&&i.parent==='dash').length).toBeGreaterThan(2);
 expect(new Set(issues.flatMap(i=>i.hermes?[i.hermes]:[])).size).toBeGreaterThanOrEqual(14);
});
