// Read-only final pair gate. Run on the two freshly downloaded Actions artifacts.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {scenarios,summarize} from './contract.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source-manifest.json')));
const load=(dir,name)=>JSON.parse(fs.readFileSync(path.join(dir,name)));
const pairs=['baseline','candidate'].map((variant,index)=>{
  const dir=path.resolve(process.argv[index+2]);
  const report=load(dir,'browser-report.json'),build=load(dir,'build.json'),runtime=load(dir,'runtime.json');
  assert.equal(fs.readFileSync(path.join(dir,'final-exit.txt'),'utf8').trim(),'0','Job runner did not exit successfully');
  assert.equal(report.variant,variant);assert.equal(report.completed,true);
  assert.deepEqual(report.summary,summarize(variant,report.scenarios));
  assert.equal(report.source,manifest[variant==='baseline'?'base_commit':'source_commit']);
  assert.equal(report.tree,manifest[variant==='baseline'?'base_tree':'source_tree']);
  assert.equal(build.commit,report.source);assert.equal(build.tree,report.tree);
  if(variant==='candidate')assert.equal(build.parent,manifest.base_commit);
  assert.equal(report.browserVersion,manifest.chromium);
  assert.equal(report.infrastructureErrors.length,0);
  for(const entry of report.scenarios) {
    assert.ok(entry.checkpoints.length>0 && entry.coverage.CityArea && entry.coverage.InputCity);
    assert.equal(entry.infraErrors.length,0);
    assert.ok(fs.statSync(path.join(dir,entry.id,'trace.zip')).size>0);
    assert.ok(fs.statSync(path.join(dir,entry.id,'final.png')).size>0);
  }
  for(const key of ['runId','runAttempt','validationCommit'])assert.equal(report[key],build[key]);
  for(const name of ['sdk.js','sdk.css','helper.css'])assert.equal(report.served['/sdk/'+name].sha256,build.inventory[name].sha256);
  return {report,build,runtime};
});
const [baseline,candidate]=pairs;
for(const key of ['runId','runAttempt','validationCommit','browserVersion'])assert.equal(baseline.report[key],candidate.report[key]);
assert.equal(baseline.report.browserExecutable.sha256,candidate.report.browserExecutable.sha256);
assert.equal(baseline.runtime.nodeSha256,candidate.runtime.nodeSha256);
assert.deepEqual(baseline.build.generatedTrackedChanges,candidate.build.generatedTrackedChanges,'Native generator output drift');
assert.deepEqual(baseline.build.dependencies,candidate.build.dependencies,'Dependency drift: inspect before claiming source-only comparison');
for(const key of Object.keys(baseline.build.anchors)) {
  if(['packages/amis-ui/src/components/CityArea.tsx','packages/amis-ui/lib/components/CityArea.js'].includes(key)) continue;
  assert.equal(baseline.build.anchors[key],candidate.build.anchors[key],`Unexpected build/source anchor drift: ${key}`);
}
assert.notEqual(baseline.build.modules.CityArea.sha256,candidate.build.modules.CityArea.sha256,'Actual native CityArea module did not change');
assert.equal(baseline.build.modules.InputCity.sha256,candidate.build.modules.InputCity.sha256,'Unrelated InputCity module drift');
console.log(JSON.stringify({paired:true,runId:candidate.report.runId,runAttempt:candidate.report.runAttempt,validationCommit:candidate.report.validationCommit,baseline:baseline.report.summary,candidate:candidate.report.summary,caseIds:scenarios.map(x=>x.id)},null,2));
