#!/usr/bin/env bash
# Run native commands unchanged; preserve every raw exit and fail the job if any
# candidate acceptance stage fails. Baseline evidence never erases that failure.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE=$(cd "$HERE/../source" && pwd)
RESULTS="$HERE/results"
BASELINE="$HERE/../baseline"
mkdir -p "$RESULTS"
printf 'stage\trole\texit_code\n' > "$RESULTS/raw-exits.tsv"
FAILED=0
LAST_RC=0

run_stage() {
  local label=$1 role=$2 directory=$3
  shift 3
  printf '\n=== %s ===\n' "$label"
  set +e
  (cd "$directory" && "$@") > "$RESULTS/$label.log" 2>&1
  LAST_RC=$?
  set -e
  printf '%s\t%s\t%s\n' "$label" "$role" "$LAST_RC" >> "$RESULTS/raw-exits.tsv"
  printf '%s: raw exit %s\n' "$label" "$LAST_RC"
  tail -n 15 "$RESULTS/$label.log"
  if [[ "$role" == acceptance && "$LAST_RC" -ne 0 ]]; then FAILED=1; fi
}

finish() {
  local shell_exit=$?
  trap - EXIT
  if [[ "$shell_exit" -ne 0 ]]; then FAILED=1; fi
  python3 - "$RESULTS" "$FAILED" "$shell_exit" <<'PY'
import csv, json, sys
from pathlib import Path
root = Path(sys.argv[1])
rows = list(csv.DictReader((root / 'raw-exits.tsv').open(), delimiter='\t'))
(root / 'summary.json').write_text(json.dumps({
    'acceptance_failed': bool(int(sys.argv[2])), 'shell_exit': int(sys.argv[3]),
    'stages': rows,
    'note': 'Raw native exits are preserved. Baseline/evidence results cannot convert a failed candidate native stage to green. Baseline shares node_modules, including candidate workspace symlinks/compiled libraries: its aggregate run is a same-dependency diagnostic comparison, not an independent baseline build. Focused CityArea uses the original baseline source mappings. Echo-only helper scripts are not test coverage.'
}, indent=2) + '\n')
PY
  exit "$FAILED"
}
trap finish EXIT

run_stage source-pre acceptance "$HERE" python3 scripts/verify.py pre "$SOURCE"
if [[ "$LAST_RC" -ne 0 ]]; then exit 1; fi

node - <<'JS' > "$RESULTS/runtime-before.json"
const {execFileSync}=require('child_process');
const keys=['GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_REPOSITORY_OWNER_ID','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion'];
const selected={};for(const key of keys)selected[key]=process.env[key] ?? null;
console.log(JSON.stringify({node:process.version,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),utc:new Date().toISOString(),effectiveTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,timezoneOffsetMinutes:new Date().getTimezoneOffset(),TZ:process.env.TZ ?? null,selected},null,2));
JS
node -e "if(process.version!=='v20.20.2')process.exit(1)"
[[ "$(npm --version)" == 10.9.9 ]]

run_stage install-root acceptance "$SOURCE" env NODE_OPTIONS=--max-old-space-size=8192 npm i --legacy-peer-deps --registry=https://registry.npmjs.org
if [[ "$LAST_RC" -ne 0 ]]; then
  printf 'Dependent native stages not run: root install failed.\n' > "$RESULTS/blocked.txt"
  run_stage source-post acceptance "$HERE" python3 scripts/verify.py post "$SOURCE"
  exit 1
fi
run_stage install-office acceptance "$SOURCE/packages/office-viewer" env NODE_OPTIONS=--max-old-space-size=8192 npm i --legacy-peer-deps --registry=https://registry.npmjs.org
OFFICE_INSTALL_RC=$LAST_RC
# npm ls may expose legacy-peer-deps invalid-peer diagnostics; record them as
# metadata, never as a replacement for actual build/type/test acceptance.
run_stage dependency-graph-root metadata "$SOURCE" npm ls --all --json
run_stage dependency-graph-office metadata "$SOURCE/packages/office-viewer" npm ls --all --json
node - "$SOURCE" <<'JS' > "$RESULTS/dependency-versions.json"
const path=require('path');const root=process.argv[2];const names=['react','react-dom','jest','ts-jest','@swc/core','@swc/jest','typescript','prettier'];const versions={};for(const name of names)versions[name]=require(path.join(root,'node_modules',name,'package.json')).version;console.log(JSON.stringify(versions,null,2));
JS

# The original PR workflow's native build order and commands.
run_stage build-formula acceptance "$SOURCE" npm run build --workspace amis-formula
run_stage build-core acceptance "$SOURCE" npm run build --workspace amis-core
run_stage build-ui acceptance "$SOURCE" npm run build --workspace amis-ui
run_stage build-amis acceptance "$SOURCE" npm run build --workspace amis
run_stage schema-copy acceptance "$SOURCE" cp ./packages/amis/schema.json .
run_stage build-editor-core acceptance "$SOURCE" npm run build --workspace amis-editor-core
run_stage build-editor acceptance "$SOURCE" npm run build --workspace amis-editor
run_stage typecheck acceptance "$SOURCE" env NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck

# Native focused regression: the exact submitted test, using existing ts-jest.
run_stage candidate-regression acceptance "$SOURCE" npm test --workspace amis -- --runInBand __tests__/renderers/Form/mobileCity.test.tsx --json --outputFile="$RESULTS/candidate-regression.json"
BASE_COMMIT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["base_commit"])' "$HERE/source-manifest.json")
run_stage create-baseline acceptance "$SOURCE" git worktree add --detach "$BASELINE" "$BASE_COMMIT"
BASELINE_READY=0
if [[ "$LAST_RC" -eq 0 ]]; then
  # Share only the installed dependencies; the existing amis workspace mappings
  # still resolve baseline source files from this separate original checkout.
  ln -s "$SOURCE/node_modules" "$BASELINE/node_modules"
  cp "$SOURCE/packages/amis/__tests__/renderers/Form/mobileCity.test.tsx" "$BASELINE/packages/amis/__tests__/renderers/Form/mobileCity.test.tsx"
  run_stage baseline-fixture acceptance "$HERE" python3 scripts/verify.py baseline-fixture "$BASELINE"
  if [[ "$LAST_RC" -eq 0 ]]; then
    run_stage baseline-regression evidence "$BASELINE" npm test --workspace amis -- --runInBand __tests__/renderers/Form/mobileCity.test.tsx --json --outputFile="$RESULTS/baseline-regression.json"
    run_stage regression-proof acceptance "$HERE" python3 scripts/verify.py regression
  fi
  git -C "$BASELINE" restore --source="$BASE_COMMIT" -- packages/amis/__tests__/renderers/Form/mobileCity.test.tsx
  run_stage baseline-original acceptance "$HERE" python3 scripts/verify.py baseline-original "$BASELINE"
  if [[ "$LAST_RC" -eq 0 ]]; then BASELINE_READY=1; fi
fi

# Original aggregate acceptance, with no TZ/transform/dependency alterations.
run_stage all-workspaces acceptance "$SOURCE" npm test --workspaces
WORKSPACES_RC=$LAST_RC
if [[ "$OFFICE_INSTALL_RC" -eq 0 ]]; then
  run_stage office-tests acceptance "$SOURCE/packages/office-viewer" npm test
else
  printf 'office-tests not run: its native install failed.\n' >> "$RESULTS/blocked.txt"
fi
# Reviewed fixed fis config uses local-deliver to ./gh-pages only. This script
# generates static files and an SDK tarball; it does not publish or push.
run_stage static-package acceptance "$SOURCE" sh deploy-gh-pages.sh

# If the aggregate fails, retain a full original-source comparison with the same
# dependency graph, including candidate workspace symlinks/compiled libraries.
# This is a diagnostic comparison, not an independent baseline build. Its outcome
# is evidence only; candidate failure still fails.
if [[ "$WORKSPACES_RC" -ne 0 && "$BASELINE_READY" -eq 1 ]]; then
  run_stage baseline-workspaces evidence "$BASELINE" npm test --workspaces
  run_stage baseline-original-after acceptance "$HERE" python3 scripts/verify.py baseline-original "$BASELINE"
fi
run_stage source-post acceptance "$HERE" python3 scripts/verify.py post "$SOURCE"
exit "$FAILED"
