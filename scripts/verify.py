#!/usr/bin/env python3
"""Fail-closed checks for the reviewed source and expected regression control."""
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'source-manifest.json').read_text())
RESULTS = ROOT / 'results'
RESULTS.mkdir(exist_ok=True)


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(name, data):
    (RESULTS / name).write_text(json.dumps(data, indent=2) + '\n')


def binding():
    expected = {
        'GITHUB_REPOSITORY': MANIFEST['repository'],
        'GITHUB_REPOSITORY_ID': MANIFEST['repository_id'],
        'GITHUB_REPOSITORY_OWNER_ID': MANIFEST['repository_owner_id'],
        'GITHUB_REF': MANIFEST['validation_ref'],
        'GITHUB_EVENT_NAME': 'push',
    }
    actual = {key: os.environ.get(key) for key in expected}
    save('binding.json', {'expected': expected, 'actual': actual,
                          'validation_sha': os.environ.get('GITHUB_SHA'),
                          'source_commit': MANIFEST['source_commit']})
    require(actual == expected, 'Repository, owner, event or exact-ref mismatch')
    source = MANIFEST['source_commit']
    require(re.fullmatch('[0-9a-f]{40}', source), 'Source SHA is UNBOUND; do not run')
    require(source != '0' * 40, 'Zero source SHA is invalid')
    validation_sha = os.environ['GITHUB_SHA']
    require(git(ROOT, 'rev-parse', 'HEAD') == validation_sha, 'Validation checkout mismatch')
    names = git(ROOT, 'ls-tree', '-r', '--name-only', 'HEAD').splitlines()
    require(sorted(names) == sorted([
        '.github/workflows/validate.yml', 'scripts/run.sh',
        'scripts/verify.py', 'source-manifest.json'
    ]), 'Validation tree must contain only the four reviewed files')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('source_sha=' + source + '\n')


def source_check(root, phase):
    root = Path(root).resolve()
    m = MANIFEST
    require(git(root, 'rev-parse', 'HEAD') == m['source_commit'], 'Source HEAD mismatch')
    require(git(root, 'rev-parse', 'HEAD^{tree}') == m['source_tree'], 'Source tree mismatch')
    require(git(root, 'show', '-s', '--format=%P', 'HEAD') == m['base_commit'],
            'Source must have exactly the approved sole parent')
    require(git(root, 'rev-parse', m['base_commit'] + '^{tree}') == m['base_tree'],
            'Baseline tree mismatch')
    expected_paths = sorted(row['path'] for row in m['files'])
    changes = git(root, 'diff-tree', '--no-commit-id', '-r', '--name-status',
                  m['base_commit'], 'HEAD').splitlines()
    require(sorted(changes) == sorted('M\t' + name for name in expected_paths),
            'Source commit changes more than the two approved files')
    rows = []
    for row in m['files']:
        path = root / row['path']
        require(path.is_file() and not path.is_symlink(), 'Unexpected source file kind')
        data = path.read_bytes()
        require(len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'],
                'Source bytes mismatch: ' + row['path'])
        entry = git(root, 'ls-tree', 'HEAD', '--', row['path']).split('\t')[0].split()
        require(entry == [row['mode'], 'blob', row['blob']], 'Blob or mode mismatch')
        require(not path.stat().st_mode & 0o111, 'Source unexpectedly executable')
        rows.append({'path': row['path'], 'sha256': row['sha256'], 'mode': row['mode'],
                     'blob': row['blob']})
    subprocess.run(['git', '-C', str(root), 'diff-tree', '--check',
                    m['base_commit'], 'HEAD'], check=True)
    changed = git(root, 'diff', '--name-only', 'HEAD').splitlines()
    allowed = set(m['generated_tracked_paths']) if phase == 'post' else set()
    require(set(changed) <= allowed, 'Unexpected tracked source mutation: ' + repr(changed))
    new_paths = git(root, 'ls-files', '--others', '--exclude-standard').splitlines()
    allowed_new = set(m['generated_nonignored_paths']) if phase == 'post' else set()
    require(set(new_paths) <= allowed_new, 'Unexpected new source/config file: ' + repr(new_paths))
    names = git(root, 'ls-tree', '-r', '--name-only', 'HEAD').splitlines()
    package_dirs = [Path(name).parent for name in names
                    if name == 'package.json' or name.endswith('/package.json')]
    lock_paths = sorted({str(directory / name) for directory in package_dirs
                         for name in ('package-lock.json', 'npm-shrinkwrap.json',
                                      'yarn.lock', 'pnpm-lock.yaml')})
    lock_hashes = {}
    for name in lock_paths:
        path = root / name
        require(not path.is_symlink(), 'Unexpected lock symlink: ' + name)
        lock_hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    if phase == 'post':
        before = json.loads((RESULTS / 'source-pre.json').read_text())['project_lock_hashes']
        for name, digest in lock_hashes.items():
            if name == 'packages/office-viewer/package-lock.json' and before[name] is None:
                continue  # Original office npm i may create this generated, untracked lock.
            require(digest == before[name], 'Unexpected project lock mutation: ' + name)
    generated = []
    for name in sorted(set(m['generated_tracked_paths'] + m['generated_artifact_paths'])):
        path = root / name
        require(not path.is_symlink(), 'Unexpected generated-file symlink: ' + name)
        if name in m['generated_tracked_paths']:
            require(path.is_file() and not path.stat().st_mode & 0o111,
                    'Tracked native generated file is missing or has changed kind/mode: ' + name)
        generated.append({'path': name, 'producer': m['generated_producers'][name],
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None})
    if phase == 'post':
        patch = subprocess.check_output(['git', '-C', str(root), 'diff', 'HEAD', '--',
                                         *m['generated_tracked_paths']])
        (RESULTS / 'native-generated.patch').write_bytes(patch)
    save('source-' + phase + '.json', {'head': m['source_commit'], 'tree': m['source_tree'],
         'parent': m['base_commit'], 'files': rows, 'native_generated_changes': changed,
         'generated_files': generated, 'project_lock_hashes': lock_hashes,
         'nonignored_new_files': new_paths,
         'status': git(root, 'status', '--porcelain', '--untracked-files=normal')})


def baseline_check(root, fixture):
    root = Path(root).resolve()
    require(git(root, 'rev-parse', 'HEAD') == MANIFEST['base_commit'], 'Baseline HEAD mismatch')
    require(git(root, 'rev-parse', 'HEAD^{tree}') == MANIFEST['base_tree'], 'Baseline tree mismatch')
    expected = ['packages/amis/__tests__/renderers/Form/mobileCity.test.tsx'] if fixture else []
    require(git(root, 'diff', '--name-only', 'HEAD').splitlines() == expected,
            'Baseline has changes other than the approved regression fixture')
    for row in MANIFEST['files']:
        if fixture and row['path'] == expected[0]:
            expected_blob = row['blob']
        else:
            expected_blob = row['baseline_blob']
        require(git(root, 'hash-object', '--no-filters', row['path']) == expected_blob,
                'Baseline source bytes mismatch: ' + row['path'])
    save('baseline-fixture.json' if fixture else 'baseline-original.json',
         {'head': MANIFEST['base_commit'], 'tree': MANIFEST['base_tree'],
          'fixture_only': expected})


def regression():
    exits = list(csv.DictReader((RESULTS / 'raw-exits.tsv').open(), delimiter='\t'))
    red_exits = [row for row in exits if row['stage'] == 'baseline-regression']
    require(len(red_exits) == 1 and red_exits[0]['exit_code'] == '1',
            'Baseline native command did not exit with the expected raw failure code 1')
    green_exits = [row for row in exits if row['stage'] == 'candidate-regression']
    require(len(green_exits) == 1 and green_exits[0]['exit_code'] == '0',
            'Candidate native regression command did not exit 0')
    baseline = json.loads((RESULTS / 'baseline-regression.json').read_text())
    candidate = json.loads((RESULTS / 'candidate-regression.json').read_text())
    for result in (baseline, candidate):
        require(result['numTotalTestSuites'] == 1 and len(result['testResults']) == 1,
                'Wrong number of regression suites')
        require(result['numPendingTests'] == 0 and result['numTodoTests'] == 0
                and result['numRuntimeErrorTestSuites'] == 0, 'Incomplete regression suite')
        suite = result['testResults'][0]
        require(suite['name'].endswith('/' + MANIFEST['regression_suite']),
                'Wrong regression suite path')
        names = sorted(a['fullName'] for a in suite['assertionResults'])
        require(names == MANIFEST['regression_full_names'], 'Regression test list mismatch')
    require((baseline['numTotalTests'], baseline['numFailedTests'], baseline['numPassedTests'])
            == (18, 11, 7), 'Baseline did not reproduce the exact expected red/control split')
    failed = [a for suite in baseline['testResults'] for a in suite['assertionResults']
              if a['status'] == 'failed']
    require(len(failed) == 11 and all(
        all(marker in '\n'.join(a['failureMessages'])
            for marker in ("reading 'map'", 'CityArea.tsx', 'updateColumns'))
        for a in failed), 'Baseline failed for a different reason')
    require((candidate['numTotalTests'], candidate['numFailedTests'], candidate['numPassedTests'])
            == (18, 0, 18), 'Candidate regression is not 18/18 green')
    save('regression-proof.json', {'baseline_raw_failure_expected': True,
         'baseline_failed': 11, 'baseline_controls_passed': 7, 'candidate_passed': 18,
         'note': 'This validates a red/green control; it does not reclassify native full-suite failures.'})


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        if command == 'binding':
            binding()
        elif command in ('pre', 'post'):
            source_check(sys.argv[2], command)
        elif command == 'baseline-fixture':
            baseline_check(sys.argv[2], True)
        elif command == 'baseline-original':
            baseline_check(sys.argv[2], False)
        elif command == 'regression':
            regression()
        else:
            raise RuntimeError('Unknown verification command')
    except Exception as error:
        save('verification-error-' + sys.argv[1] + '.json', {'error': str(error)})
        raise
