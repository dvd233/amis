import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
test('browser entry refuses non-hosted execution before importing Playwright or listening',()=>{
  const env={...process.env};delete env.GITHUB_ACTIONS;
  const result=spawnSync(process.execPath,[path.join(root,'scripts/browser.mjs'),root,'candidate'],{env,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Execution identity: GITHUB_ACTIONS/);
  assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|listen|Executable doesn't exist/);
});
test('exact shell stage function preserves nonzero and unexpected shell exits',()=>{
  const script=fs.readFileSync(path.join(root,'scripts/run.sh'),'utf8');
  const body=script.slice(script.indexOf('stage() {'),script.indexOf('\nstage source-pre'));
  const trap=script.split('\n').find(x=>x.startsWith('trap '));
  for(const [command,expected] of [["stage sample \"$RESULTS\" bash -c 'exit 0'",0],["stage sample \"$RESULTS\" bash -c 'exit 7'",7],["stage sample \"$RESULTS\" bash -c 'exit 1'; stage falsely-green \"$RESULTS\" true",1],["false",1]]) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'amis-stage-selftest-'));
    const result=spawnSync('bash',['-c',`set -euo pipefail\nRESULTS=${JSON.stringify(dir)}\nprintf 'stage\\texit_code\\n' > "$RESULTS/raw-exits.tsv"\n${trap}\n${body}\n${command}`],{encoding:'utf8'});
    assert.equal(result.status,expected);
    assert.equal(fs.readFileSync(path.join(dir,'final-exit.txt'),'utf8').trim(),String(expected));
    assert.doesNotMatch(fs.readFileSync(path.join(dir,'raw-exits.tsv'),'utf8'),/falsely-green/);
  }
});
test('outcomes are classified only after screenshot, trace, last state and context shutdown',()=>{
  const code=fs.readFileSync(path.join(root,'scripts/browser.mjs'),'utf8');
  const finalScreenshot=code.indexOf("path.join(dir,'final.png')");
  const trace=code.indexOf('await context.tracing.stop',finalScreenshot);
  const state=code.indexOf('entry.finalState=await read()',trace);
  const close=code.indexOf('await context.close()',state);
  const pending=code.indexOf('await Promise.all(pending)',close);
  const classify=code.indexOf('entry.status=classify(',pending);
  assert.ok(finalScreenshot>0&&trace>finalScreenshot&&state>trace&&close>state&&pending>close&&classify>pending);
});
