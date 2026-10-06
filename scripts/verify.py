#!/usr/bin/env python3
"""Fail closed on execution identity, payload, source tree and tracked drift."""
import hashlib, json, os, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
M = json.loads((ROOT / 'source-manifest.json').read_text())
def check(ok, message):
    if not ok: raise AssertionError(message)
def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()
def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def guard():
    expected = {'GITHUB_ACTIONS':'true', 'CI':'true', 'GITHUB_REPOSITORY':M['repository'],
        'GITHUB_REPOSITORY_ID':M['repository_id'], 'GITHUB_REPOSITORY_OWNER_ID':M['repository_owner_id'],
        'GITHUB_REF':M['validation_ref'], 'GITHUB_EVENT_NAME':'push'}
    for key, value in expected.items(): check(os.environ.get(key) == value, f'Execution identity: {key}')
    for key in ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT']: check(os.environ.get(key, '').isdigit(), key)
    check(git(ROOT, 'rev-parse', 'HEAD') == os.environ['GITHUB_SHA'], 'Validation commit mismatch')
    inventory = json.loads((ROOT / 'payload-files.json').read_text())
    actual = git(ROOT, 'ls-files').splitlines()
    check(sorted(actual) == sorted([*inventory, 'payload-files.json']), 'Validation tracked-file allowlist')
    for name, hash_ in inventory.items(): check(digest(ROOT/name) == hash_, f'Payload changed: {name}')
    check(not git(ROOT, 'diff', '--name-only', 'HEAD'), 'Validation tracked drift')
    return expected

def source_check(source, variant, phase):
    source = Path(source).resolve()
    commit = M['base_commit' if variant == 'baseline' else 'source_commit']
    tree = M['base_tree' if variant == 'baseline' else 'source_tree']
    check(git(source, 'rev-parse', 'HEAD') == commit, 'Wrong source commit')
    check(git(source, 'rev-parse', 'HEAD^{tree}') == tree, 'Wrong source tree')
    if variant == 'candidate':
        check(git(source, 'rev-parse', 'HEAD^') == M['base_commit'], 'Wrong candidate parent')
        diff = git(source, 'diff-tree','--no-commit-id','--name-only','-r','HEAD').splitlines()
        check(sorted(diff) == sorted(f['path'] for f in M['files']), 'Unexpected source delta')
    generated = {'packages/amis-formula/src/doc.ts', 'packages/amis-formula/src/doc.md'} if phase == 'post' else set()
    dirty = set(git(source,'diff','--name-only','HEAD').splitlines())
    check(not dirty - generated, f'Unexpected tracked changes: {dirty-generated}')
    untracked = set(git(source, 'ls-files', '--others', '--exclude-standard').splitlines())
    check(not untracked - ({'schema.json'} if phase == 'post' else set()), f'Unexpected untracked source files: {untracked}')
    for f in M['files']:
        check(git(source, 'hash-object', '--no-filters', f['path']) == f['baseline_blob' if variant == 'baseline' else 'blob'], f'Target changed: {f["path"]}')
    if phase == 'pre':
        for name in ['amis-formula','amis-core','amis-ui','amis']:
            for output in ['lib','esm']:
                check(not (source/'packages'/name/output).exists(), f'Preexisting build output: {name}/{output}')
        check(not (source/'packages/amis/sdk').exists(), 'Preexisting SDK')
    record = {'variant':variant,'phase':phase,'commit':commit,'tree':tree,'parent':git(source, 'rev-parse', 'HEAD^'),
        'generatedTrackedChanges':{p:digest(source/p) for p in sorted(dirty)},
        'runId':os.environ['GITHUB_RUN_ID'],'runAttempt':os.environ['GITHUB_RUN_ATTEMPT'],
        'validationCommit':os.environ['GITHUB_SHA']}
    (ROOT/'results').mkdir(exist_ok=True)
    (ROOT/'results'/f'source-{phase}.json').write_text(json.dumps(record,indent=2)+'\n')
    return record

if __name__ == '__main__':
    mode = sys.argv[1]
    identity = guard()
    if mode == 'binding':
        variant = sys.argv[2]
        check(variant in ['baseline','candidate'], 'Invalid variant')
        sha = M['base_commit' if variant == 'baseline' else 'source_commit']
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f: f.write(f'source_sha={sha}\n')
    elif mode in ['pre','post']:
        print(json.dumps(source_check(sys.argv[2],sys.argv[3],mode),indent=2))
    else: raise ValueError(mode)
