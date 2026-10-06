// Metadata-only: resolve public module paths, then read JSON. Never load package JS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export function packageMetadata(name,requireFromSource,source) {
  const root=fs.realpathSync(source);
  const boundary=fs.realpathSync(path.join(root,'node_modules'));
  function checked(file) {
    const real=fs.realpathSync(file),relative=path.relative(boundary,real);
    assert.ok(relative && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative),`Package metadata escaped node_modules: ${name}`);
    return real;
  }
  let file,entry,resolution='exported-package-json';
  try {
    file=checked(requireFromSource.resolve(`${name}/package.json`));
  } catch(error) {
    if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // Only a hidden metadata export permits this fallback. Resolve the allowed
    // package entry and walk its real ancestry without importing/executing it.
    entry=checked(requireFromSource.resolve(name));
    resolution='public-entry-ancestry';
    let directory=path.dirname(entry);
    while(directory!==boundary) {
      const candidate=path.join(directory,'package.json');
      if(fs.existsSync(candidate)) {
        const manifest=checked(candidate),value=JSON.parse(fs.readFileSync(manifest,'utf8'));
        if(value.name===name) {file=manifest;break;}
        assert.equal(value.name,undefined,`Unexpected package name while resolving ${name}`);
      }
      directory=path.dirname(directory);
    }
    assert.ok(file,`No matching metadata for public package entry: ${name}`);
  }
  const bytes=fs.readFileSync(file),metadata=JSON.parse(bytes.toString('utf8'));
  assert.equal(metadata.name,name,`Unexpected package name for ${name}`);
  assert.ok(typeof metadata.version==='string' && metadata.version.trim(),`Missing package version: ${name}`);
  return {name,version:metadata.version,packagePath:path.relative(root,file),
    sha256:crypto.createHash('sha256').update(bytes).digest('hex'),resolution,
    ...(entry?{entryPath:path.relative(root,entry)}:{})};
}
