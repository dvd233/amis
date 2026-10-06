# Source-bound AMIS mobile InputCity browser validation

Status: prepared and statically checked only. No browser was launched, listener opened, source dependency installed, remote branch changed, workflow published or result fabricated during preparation. This payload is intended only for the user's authorized isolated fork Actions branch. It is not an upstream production change or a full-CI pass.

## Exact source and execution scope

- Fork: `dvd233/amis`, repository ID `1368236760`, owner ID `111864431`.
- Proposed isolated validation ref: `refs/heads/codex/validate-amis-mobile-browser-20261006`.
- Baseline: `43a33ee066990589f5891674e645c4c927761fe5`, tree `236cfb880d4087ac8b0a82f723d6161d46a7760c`.
- Candidate: `5263bd31f971e4cd38958bec6c326df096b5d9e2`, tree `92b07b1c9e3974a8de866ad682ac93ded94b9c3c`, direct parent is the baseline. Exactly two changed upstream files are allowed. Their Git blobs and SHA-256 are in `source-manifest.json`.
- Two matrix jobs have separate clean source checkouts, dependency installations and builds. They do not share candidate workspace symlinks, libraries, mocks or browser outputs.
- Only `contents: read`; checkout credentials are not persisted. No secrets, deployment, upstream/default-branch changes, old PR changes, publishing, push, workflow settings or source edits occur in this workflow.
- Every browser/listener entry is guarded by exact Actions repository IDs, ref, event, validation commit and payload inventory. Never set these environment variables locally to bypass the guard. Local browser/listener execution is prohibited for this task.

## What executes

Node `20.20.2`, npm `10.9.9`, upstream official npm installation with `--legacy-peer-deps`, followed by the unchanged native commands:

1. `npm run build --workspace amis-formula`
2. `npm run build --workspace amis-core`
3. `npm run build --workspace amis-ui`
4. `npm run build --workspace amis`

The fourth command includes the original FIS SDK, native CSS, assets, locale and schema generation. There is no substitute bundler, modified TypeScript configuration, stub component, altered database or injected component CSS. The harness imports `/sdk/sdk.js`, `/sdk/sdk.css` and `/sdk/helper.css` freshly emitted by this checkout. Its only inline CSS formats the outer page/evidence text.

`amisRequire('amis/embed').embed` renders an actual named Form containing schema `type: 'input-city'`, with `mobileUI: true`. Form `onChange` records real data and feeds it back through `scoped.updateProps`. The real InputCity renderer `change` event is independently recorded. `getComponentByName('cityForm').getValues()` checks committed data. No test-only CityArea component is mounted.

The current native InputCity implementation selects CityArea only when mobileUI is true (`packages/amis/src/renderers/Form/InputCity.tsx`). Runtime proof requires real CityArea DOM creation, actual form mobileUI, and V8 coverage of both the inner InputCity render function and CityArea render callback. Their exact smallest matching AST function ranges are fixed at build time; runtime coverage must match those exact ranges and have a positive count. An executed outer class IIFE cannot substitute for an unexecuted render method. Original FIS SDK strips source maps, so the harness records native source/lib hashes, exact AST-located SDK factory ranges and hashes, executed-function UTF-16 offsets, and the first error stack frame's SDK UTF-16 character location. It does not pretend that a source map exists.

Chromium runs sandboxed in mobile emulation at 390 × 844, touch enabled. Controls are tapped; clipped picker wheels are moved with trusted CDP touch sequences, one native 40-pixel row at a time, with a pause before release to avoid intentional fling inertia. No synthetic DOM click, forced click, CSS/scroll-offset manipulation or React-state modification selects an option. This is real Chromium mobile-emulation coverage, not a physical Android/iOS device, and does not establish fling-inertia quality or Safari behavior.

## Minimal sufficient scenarios (14 per variant)

1. Initial numeric Chengkou `500229`, exact two-level label, empty third column, confirm and reopen.
2. Initial string Fengdu `500230`, same checks.
3. Initial string Xiantao `429004`, same checks.
4–7. Ordinary Beijing `110101`, Shanghai `310101`, Chongqing Wanzhou `500101`, Chengdu `510104`; correct label, nonempty third column, confirmed code.
8. Wanzhou → Chengkou, controlled feedback, candidate county cancel/overlay and reopen, ordinary-city return, Fengdu confirmation.
9. Pending Chengkou cancellation and pending Fengdu overlay dismissal from committed Wanzhou. No renderer/form change; reopen restores the committed county and ordinary district.
10. Chengdu → Hubei Xiantao → Chongqing Chengkou → Chengdu, with code, level and label checks.
11. `allowCity=true, allowDistrict=false`: two columns and `500229`.
12. `allowCity=false, allowDistrict=false`: one column and `500000`.
13. `allowCity=false, allowDistrict=true`: preserve existing one-column / `500229` behavior rather than broadening the fix.
14. Structured ordinary value → Chengkou → Fengdu, `extractValue=false`: compare real event/form data, final county code, province and city fields, with no fictitious district code.

The baseline is required to actually fail only scenarios 1–3 during initial restoration and 8/10/14 after the first county confirmation and actual form change. Each such failure needs a `TypeError` reading `map` with its FIRST stack frame inside the freshly built CityArea module. Other exceptions, missing coverage, wrong phases, unexpected console errors, failed requests, failed assertions, or a baseline that does not reproduce are failures. The six cases are not counted as passed; their status is `expected-baseline-regression`, and steps after the original crash are not claimed as exercised. Every case gets a fresh context/page, so crashes are never swallowed into the next case. The eight unchanged baseline control cases must pass normally. Candidate requires all 14 to pass without runtime errors.

## Evidence and failure propagation

Native stage logs and raw exit codes are kept. `set -euo pipefail`, checked stage returns and an EXIT trap preserve failing native, harness, browser or unexpected shell exits. Candidate errors cannot be turned green by baseline comparisons. Matrix `fail-fast: false` permits both independent jobs to retain evidence even when one fails.

Each case writes screenshots, a Playwright trace, checkpoint DOM/labels/column counts/selected labels, renderer payloads, form data/change history, controlled-feedback counts, runtime errors, SDK-module-offset attribution and execution coverage. Build evidence hashes every native SDK asset and relevant native source/lib/CSS producer; the loopback static server serves only these files and verifies their hashes on each request. Non-loopback requests fail the scenario. Build/run/validation IDs and fresh timestamps bind the evidence to this invocation. Official SDK source maps are absent; offset attribution is explicitly disclosed.

Artifacts: `amis-mobile-baseline-RUN-ATTEMPT` and `amis-mobile-candidate-RUN-ATTEMPT`, retained 14 days. Screenshots and traces are produced on the hosted execution only; no placeholders stand in for observed evidence.

After downloading both artifacts, run the read-only final pair gate:

`node scripts/compare.mjs /path/to/baseline-artifact /path/to/candidate-artifact`

It requires both complete reports and successful job exits, all 14 exact cases, screenshots/traces, same run/attempt/validation commit, same Chromium and Node binaries, the same recorded dependency versions and unchanged unrelated build/source anchors. A changed actual CityArea SDK module and unchanged InputCity SDK module are required. The source intentionally has no dependency lockfile; retain both full dependency graphs and inspect any transitive drift before claiming an isolated source-only comparison. This final pair review is required before claiming the browser gate passed; green matrix jobs alone are not the final source-only comparison.

The previous native full-CI date assertion failures are outside this browser workflow and remain separately reported; this does not erase or rerun that full acceptance gate.

## Official dependency/action provenance

- Playwright Core `1.56.1` is locked to the official npm URL and integrity in `package-lock.json`. The entry was copied byte-for-byte from the already-audited official-registry lock; unused esbuild entries were removed. No install occurred locally.
- The pinned Playwright `browsers.json` SHA-256, Chromium revision `1194`, and browser version `141.0.7390.37` are checked before launch. Browser binaries are installed using the package's own CLI, with no custom download host or executable source. Launch uses Playwright's bundled full Chromium channel with `chromiumSandbox: true`; executable hash/version are recorded.
- Official Playwright guidance: https://playwright.dev/docs/browsers , https://playwright.dev/docs/api/class-browsertype , https://playwright.dev/docs/api/class-tracing . These documents were read during preparation. The browser version is pinned for reproducibility, not claimed to be the latest release.
- Official `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` are commit-pinned. `actions-lock-source.json` preserves the same-day prior read-only official-tag verification evidence; no fresh remote lookup or publication was done by this preparer.
- Repository contribution guide, PR template, native scripts, SDK example, Form API docs and relevant sources were read. No repository AGENTS.md or .agents skills were present in the source archive.

## Publication procedure

Root and an independent reviewer must review the exact frozen payload and proposed ref first. Publish only files listed in `payload-files.json` plus that inventory file, as the independent validation tree. Verify the resulting remote tree and commit before trusting the run. Do not copy these harness files into the production source branch. Any later byte change needs a new freeze and delta review. The payload's own tracked bytes are guarded against its checked-out validation commit.
