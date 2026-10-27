import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { textPreview } from "./text-preview";
test('text preview keeps file boundary, rejects hidden/binary/large and redacts plaintext', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dash-text-')));
  try {
    writeFileSync(join(dir,'ok.ts'),'const x = 1;\nAPI_KEY=private-secret');
    const response = await textPreview(join(dir,'ok.ts'),[dir]);
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('private-secret');
    expect(response.headers.get('content-type')).toContain('text/plain');
    writeFileSync(join(dir,'.env'),'NORMAL=private');
    expect((await textPreview(join(dir,'.env'),[dir])).status).toBe(403);
    expect((await textPreview('/etc/passwd',[dir])).status).toBe(403);
    writeFileSync(join(dir,'binary.dat'),Buffer.from([0,1,2]));
    expect((await textPreview(join(dir,'binary.dat'),[dir])).status).toBe(415);
    writeFileSync(join(dir,'huge.txt'),'x'.repeat(1048577));
    expect((await textPreview(join(dir,'huge.txt'),[dir])).status).toBe(413);
    symlinkSync('/etc/passwd',join(dir,'escape.txt'));
    expect((await textPreview(join(dir,'escape.txt'),[dir])).status).toBe(403);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
