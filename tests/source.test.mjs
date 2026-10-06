import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
test('source guard rejects wrong tree, wrong parent, dirty files, injected source and stale outputs',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const code=String.raw`
import importlib.util, tempfile, pathlib, subprocess, os, json, sys
spec=importlib.util.spec_from_file_location('verify',sys.argv[1]);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
tmp=pathlib.Path(tempfile.mkdtemp(prefix='amis-source-guard-'));s=tmp/'source';s.mkdir();v.ROOT=tmp/'validation';v.ROOT.mkdir()
def git(*args): return subprocess.check_output(['git','-C',str(s),*args],text=True).strip()
git('init','--quiet');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid')
(s/'one').write_text('before-one');(s/'two').write_text('before-two');(s/'unchanged').write_text('original')
doc=s/'packages/amis-formula/src/doc.ts';doc.parent.mkdir(parents=True);doc.write_text('original-doc')
git('add','.');git('commit','--quiet','-m','ancestor');git('commit','--quiet','--allow-empty','-m','baseline')
base=git('rev-parse','HEAD');base_tree=git('rev-parse','HEAD^{tree}')
files=[{'path':n,'baseline_blob':git('hash-object',n)} for n in ['one','two']]
for f in files: (s/f['path']).write_text('candidate-'+f['path'])
git('add','.');git('commit','--quiet','-m','candidate')
for f in files: f['blob']=git('hash-object',f['path'])
v.M={'base_commit':base,'base_tree':base_tree,'source_commit':git('rev-parse','HEAD'),'source_tree':git('rev-parse','HEAD^{tree}'),'files':files}
os.environ.update(GITHUB_RUN_ID='1',GITHUB_RUN_ATTEMPT='1',GITHUB_SHA='fixture-validation')
def must_fail(fn):
 try: fn()
 except AssertionError: return
 raise AssertionError('Malformed fixture was accepted')
v.source_check(s,'candidate','pre')
original=v.M['source_tree'];v.M['source_tree']='wrong';must_fail(lambda:v.source_check(s,'candidate','pre'));v.M['source_tree']=original
original=v.M['base_commit'];v.M['base_commit']='wrong';must_fail(lambda:v.source_check(s,'candidate','pre'));v.M['base_commit']=original
(s/'unchanged').write_text('tampered');must_fail(lambda:v.source_check(s,'candidate','post'));git('restore','unchanged')
(s/'injected.ts').write_text('unexpected');must_fail(lambda:v.source_check(s,'candidate','post'));(s/'injected.ts').unlink()
(s/'packages/amis/sdk').mkdir(parents=True);must_fail(lambda:v.source_check(s,'candidate','pre'));(s/'packages/amis/sdk').rmdir()
doc.write_text('generated');v.source_check(s,'candidate','post');must_fail(lambda:v.source_check(s,'candidate','pre'));git('restore',str(doc.relative_to(s)))
(s/'one').write_text('tampered');must_fail(lambda:v.source_check(s,'candidate','post'));git('restore','one')
git('checkout','--quiet','--detach',base);v.source_check(s,'baseline','pre')
print('8 source guard positive/negative probes passed')
`;
  const result=spawnSync('python3',['-c',code,path.join(root,'scripts/verify.py')],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/8 source guard positive\/negative probes passed/);
});
