import { test, expect } from 'playwright/test';
import { hostsTree } from '../../app/src/lib/hosts-tree';
import type { HostInfo } from '../../shared/protocol';
import { childNodes, type TreeNode } from '../../app/src/lib/tree';

// Consumer invariant only: the mounted pane supplies the authoritative open guard.
// This does not prove bridge availability or native-device acceptance.
test('Hosts tree preserves history while honoring authoritative action eligibility', async () => {
 const host: HostInfo = {
  id:'paired',name:'Paired',hostname:'paired',self:true,online:true,
  agents:[
   {id:'omp:history',name:'History',kind:'omp',status:'offline',sessionId:'old',cwd:'/repo'},
   {id:'harness:omp',name:'OMP',kind:'omp',status:'available'},
   {id:'hermes:restricted',name:'Restricted',kind:'hermes',status:'available'},
   {id:'remote:routed',name:'Routed',kind:'claude',status:'running',sessionId:'live'},
  ],
  bots:[{id:'bot',name:'Bot',runtime:'hermes',status:'available',channels:[],agentId:'hermes:restricted'}],
 };
 const opened: string[] = [];
 const flatten = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
  const rows: TreeNode[] = [];
  for (const node of nodes) rows.push(node, ...await flatten(await childNodes(node)));
  return rows;
 };
 const rows = await flatten(hostsTree([host], (_host,agent) => opened.push(agent.id), () => {}, (_host,agent) => agent.id === 'remote:routed', 0));
 const history = rows.find(row => row.id === 'paired:session:omp:history');
 expect(history).toBeDefined();
 expect(history?.onPress).toBeUndefined();
 expect(history && (await childNodes(history))[0]?.detail).toBe('/repo');
 expect(rows.find(row => row.id === 'paired:new:harness:omp')?.onPress).toBeUndefined();
 expect(rows.find(row => row.id === 'paired:bot:bot:new')?.onPress).toBeUndefined();
 const routed = rows.find(row => row.id === 'paired:session:remote:routed');
 expect(routed?.onPress).toBeDefined();
 routed?.onPress?.();
 expect(opened).toEqual(['remote:routed']);
 const refreshed = await flatten(hostsTree([host], () => {}, () => {}, () => true, 0));
 expect(refreshed.find(row => row.id === 'paired:new:harness:omp')?.onPress).toBeDefined();
 expect(refreshed.find(row => row.id === 'paired:bot:bot:new')?.onPress).toBeDefined();
});
