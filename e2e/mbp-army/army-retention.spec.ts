import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from 'playwright/test';

test('finished headed army runs retain three bulky outputs per suite without touching active runs', ({}, info) => {
  const root = info.outputPath('headed-army');
  mkdirSync(root, { recursive: true });
  const python = (code: string, ...args: string[]) => execFileSync('python3', ['-B', '-c',
    'import sys; from pathlib import Path; from retention import reserve, finish; base = Path(sys.argv[1]); ' + code,
    root, ...args], { cwd: resolve(__dirname) });
  const reserve = (name: string) => {
    python('reserve(base, sys.argv[2])', name);
    for (const path of [name, name + '-html']) mkdirSync(join(root, path));
    writeFileSync(join(root, name + '.json'), '{}');
  };
  const finish = (name: string, suite: string) => python('finish(base, sys.argv[2], sys.argv[3])', name, suite);
  reserve('active');
  reserve('other');
  finish('other', 'filtered');
  reserve('oldest');
  const unrelated = join(root, 'unrelated');
  mkdirSync(unrelated);
  symlinkSync(unrelated, join(root, '.run-retention', 'oldest', 'tmp', 'outside'));
  finish('oldest', 'full');
  for (const name of ['second', 'third', 'fourth']) {
    reserve(name);
    finish(name, 'full');
  }
  for (const path of ['oldest', 'oldest-html', '.run-retention/oldest/tmp']) {
    expect(existsSync(join(root, path)), path).toBe(false);
  }
  for (const name of ['active', 'other', 'second', 'third', 'fourth']) {
    for (const path of [name, name + '-html', '.run-retention/' + name + '/tmp']) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  }
  expect(existsSync(unrelated)).toBe(true);
  expect(existsSync(join(root, 'oldest.json'))).toBe(true);
});
