import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {packageMetadata} from '../scripts/package-metadata.mjs';
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'amis-metadata-'));
  fs.mkdirSync(path.join(root,'node_modules'));fs.writeFileSync(path.join(root,'package.json'),'{}');
  return {root,require:createRequire(path.join(root,'package.json')),add(name,metadata) {
    const dir=path.join(root,'node_modules',name);fs.mkdirSync(path.join(dir,'dist'),{recursive:true});
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.2.3',...metadata}));
    fs.writeFileSync(path.join(dir,'dist/index.cjs'),"throw new Error('Package JS must never execute during metadata observation');");
    return dir;
  }};
}
test('ordinary public metadata is read without executing package code',()=>{
  const f=fixture();f.add('visible',{main:'dist/index.cjs'});
  const result=packageMetadata('visible',f.require,f.root);
  assert.equal(result.version,'1.2.3');assert.equal(result.resolution,'exported-package-json');
  assert.equal(result.packagePath,'node_modules/visible/package.json');assert.match(result.sha256,/^[0-9a-f]{64}$/);
});
test('hidden package.json resolves the public entry and its actual manifest',()=>{
  const f=fixture();const dir=f.add('@test/hidden',{exports:{'.':'./dist/index.cjs'}});
  fs.writeFileSync(path.join(dir,'dist/package.json'),JSON.stringify({type:'commonjs'}));
  assert.throws(()=>f.require.resolve('@test/hidden/package.json'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  const result=packageMetadata('@test/hidden',f.require,f.root);
  assert.equal(result.version,'1.2.3');assert.equal(result.resolution,'public-entry-ancestry');
  assert.equal(result.packagePath,'node_modules/@test/hidden/package.json');
  assert.equal(result.entryPath,'node_modules/@test/hidden/dist/index.cjs');
});
test('unexpected package names and empty/missing versions fail closed',()=>{
  for(const metadata of [{name:'different'},{version:''},{version:undefined}]) {
    const f=fixture();f.add('broken',{exports:{'.':'./dist/index.cjs'},...metadata});
    assert.throws(()=>packageMetadata('broken',f.require,f.root));
  }
  const f=fixture();const dir=f.add('nested',{exports:{'.':'./dist/index.cjs'}});
  fs.writeFileSync(path.join(dir,'dist/package.json'),JSON.stringify({name:'unexpected',version:'1.0.0'}));
  assert.throws(()=>packageMetadata('nested',f.require,f.root),/Unexpected package name/);
});
test('missing packages and unsupported public entries are not swallowed',()=>{
  const f=fixture();assert.throws(()=>packageMetadata('absent',f.require,f.root),{code:'MODULE_NOT_FOUND'});
  f.add('no-entry',{exports:{'./supported':'./dist/index.cjs'}});
  assert.throws(()=>packageMetadata('no-entry',f.require,f.root),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
});
test('public entry or metadata symlinks cannot escape the dependency boundary',()=>{
  const f=fixture(),outside=path.join(f.root,'outside');fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside,'index.cjs'),"throw new Error('must not execute');");
  const dir=f.add('escape',{exports:{'.':'./dist/index.cjs'}});
  fs.unlinkSync(path.join(dir,'dist/index.cjs'));fs.symlinkSync(path.join(outside,'index.cjs'),path.join(dir,'dist/index.cjs'));
  assert.throws(()=>packageMetadata('escape',f.require,f.root),/escaped node_modules/);
  const visible=f.add('visible',{main:'dist/index.cjs'});
  fs.writeFileSync(path.join(outside,'package.json'),JSON.stringify({name:'visible',version:'1.0.0'}));
  fs.unlinkSync(path.join(visible,'package.json'));fs.symlinkSync(path.join(outside,'package.json'),path.join(visible,'package.json'));
  assert.throws(()=>packageMetadata('visible',f.require,f.root),/escaped node_modules/);
});
