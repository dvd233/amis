#!/usr/bin/env bash
# Hosted only. All native source builds are separate per matrix checkout.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE=$(cd "$HERE/../source" && pwd)
VARIANT=${1:?baseline or candidate required}
RESULTS="$HERE/results"
mkdir -p "$RESULTS"
printf 'stage\texit_code\n' > "$RESULTS/raw-exits.tsv"
trap 'rc=$?; printf "%s\n" "$rc" > "$RESULTS/final-exit.txt"; exit "$rc"' EXIT
stage() {
  local name=$1 directory=$2
  shift 2
  set +e
  (cd "$directory" && "$@") > "$RESULTS/$name.log" 2>&1
  local rc=$?
  set -e
  printf '%s\t%s\n' "$name" "$rc" >> "$RESULTS/raw-exits.tsv"
  tail -n 12 "$RESULTS/$name.log"
  [[ "$rc" -eq 0 ]] || return "$rc"
}
stage source-pre "$HERE" python3 scripts/verify.py pre "$SOURCE" "$VARIANT"
[[ "$(node --version)" == v20.20.2 ]]
[[ "$(npm --version)" == 10.9.9 ]]
node - <<'JS' > "$RESULTS/runtime.json"
const fs=require('fs'),crypto=require('crypto');
const env={}; for(const k of ['GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_REPOSITORY_OWNER_ID','GITHUB_SHA','GITHUB_REF','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion'])env[k]=process.env[k];
console.log(JSON.stringify({node:process.version,nodeSha256:crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),utc:new Date().toISOString(),env},null,2));
JS
stage harness-selftests "$HERE" npm run check
stage install-harness "$HERE" npm ci --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund
stage install-source "$SOURCE" env NODE_OPTIONS=--max-old-space-size=8192 npm i --legacy-peer-deps --registry=https://registry.npmjs.org --no-audit --no-fund
# npm ls can report invalid peers with native --legacy-peer-deps; retain as metadata only.
set +e
(cd "$SOURCE" && npm ls --all --json) > "$RESULTS/dependency-graph.json" 2> "$RESULTS/dependency-graph.stderr"
printf '%s\n' "$?" > "$RESULTS/dependency-graph.exit"
set -e
for workspace in amis-formula amis-core amis-ui amis; do
  stage "build-$workspace" "$SOURCE" env NODE_OPTIONS=--max-old-space-size=8192 npm run build --workspace "$workspace"
done
stage source-post "$HERE" python3 scripts/verify.py post "$SOURCE" "$VARIANT"
stage provenance "$HERE" node scripts/build-provenance.mjs "$SOURCE" "$VARIANT"
# Browser installation and execution are reached only after native builds and source guards.
stage install-chromium "$HERE" node node_modules/playwright-core/cli.js install --with-deps chromium
stage browser "$HERE" node scripts/browser.mjs "$SOURCE" "$VARIANT"
stage source-final "$HERE" python3 scripts/verify.py post "$SOURCE" "$VARIANT"
