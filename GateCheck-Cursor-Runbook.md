# GateCheck: sequential Cursor runbook

Repository: https://github.com/its-advait/B-B-Hacks
Current starting point: Cursor is already building the common scaffold from the strengthened scaffold prompt. Let that task finish. Do not restart it or queue the entire runbook.

Use this file alongside GateCheck-Team-Build-Plan.md. That plan defines shared types and endpoints; this runbook defines the order, verification gates, recovery paths, and manual actions. It does not claim the repo's current code has been inspected or tested.

## Operating rules

Send ONE numbered prompt at a time in your local Cursor Agent. Continue only when its gate passes. A build passing does not prove a browser workflow works. Cursor should report not tested when it cannot test something. Ask it to explain unfamiliar actions. Installation/sign-in, teammate readiness, branch conflict decisions, UI checks, recording, and submission can require you.

You own frontend, shared scaffold and integration. Teammate A owns ledger; B owns API/policy. Do not have your Cursor agent independently implement their modules. Their staged prompts appear later in this document.

Keep the successful scaffold on main, then branch ui. Teammates clone that scaffold into ledger and api branches. Integrate early working increments. Commit only verified milestones or explicitly labeled work-in-progress checkpoints. Never force-push or discard teammate changes.

For every coding prompt below, attach the plan and relevant files. Paste exact terminal errors on failures. Cursor may run commands and inspect docs. No routine permission question is needed for files within your assignment, but pause on scope changes, shared-interface conflicts, production money, secrets in history, or ambiguous merge conflicts.

Build only the incoming-Payment credential/direct-approval workflow. Skip OPA, LLM chat, RLUSD, escrow, DEX, lending, arbitrary policy compiler, production account cloning, login systems, and additional sponsor integrations. XRP testing money is sufficient for native authorization checks. Do not confuse incoming permissions with outgoing spending limits.

## Revised clock

Aim: verified scaffold and teammate handoff by 2:25; layout by 2:45; live setup visible by 3:00; first real before-report by 3:30; repair/after-report by 4:00. Freeze features at 4:00; complete final verification by 4:15. Record/upload 4:15-4:45. Submit by 5:00 for the 5:15 deadline and 15-minute buffer. These are decision gates, not guaranteed build durations.

If ledger credentials are not working by 2:30, A gets help from the Ripple mentor immediately. If repair fails by 4:00, show real findings plus the reviewable repair proposal and disclose that execution is incomplete. If no real ledger flow exists by 3:30, stop polishing and the team focuses on that blocker.

## Your prompts: start after the current scaffold finishes

### 1. Verify the scaffold instead of rebuilding it

```text
Continue from the scaffold you just built. Read GateCheck-Team-Build-Plan.md.
Do not rebuild correct work or start product features.

Verify the original scaffold requirements: exact shared types; React/Vite client; Express server; /api/health; relative /api proxy; one root package and lockfile; dev/typecheck/build/start scripts; production server serving built frontend; correct Git ignores and README.

Run typecheck and build. Verify /api/health directly and through the Vite proxy. Test production startup on a free port without destroying unrelated processes. Confirm the built frontend is served. If browser tools are available, inspect the page and network request; otherwise explicitly say browser behavior is not tested and give me the URL and manual check.

Fix failures only within scaffold scope. Preserve the exact shared interfaces. Do not add ledger, policy, report or repair features.

Finish with a table of passed/failed/not-tested checks, files changed, the development URL, and unresolved issues. Do not commit or push yet.
```

Gate: typecheck/build pass; health endpoint works; you open the local frontend and see a health success state. Production command is verified or a specific issue is documented for immediate correction. Missing Node/npm/Git is an installation task, not an application rewrite. Use recovery prompt R1 or R2 if needed.

### 2. Publish the shared foundation

```text
Inspect git status, remotes, and current branch first. This repository is its-advait/B-B-Hacks. Commit and push the verified common scaffold plus build plan to main, preserving any remote commits. Do not force-push.

Before committing, check staged paths and content for environment files, wallet seeds, private runtime data, and accidentally included dependencies/build outputs. Do not print secrets. Stage only intended project files. If user.name/user.email or GitHub authentication is missing, stop and tell me the exact user action needed; do not invent an identity.

After push succeeds, show the commit ID and list of shared interfaces/config files. Then create/switch my local working branch to ui if it does not already exist. Do not modify product features yet.
```

Gate: pushed commit visible on GitHub; local branch ui. You tell teammates to clone/pull this scaffold and start their own staged prompts. Confirm the repository owner has given them collaborator access. A can research/verify network support before the scaffold is ready.

### 3. Build the dashboard layout

```text
Read Task C and the shared types. Work only in src/client/**. Implement one clear desktop dashboard for GateCheck, not a marketing site.

Include Testnet / fake funds label, Create test environment, current account settings, intended policy, actor statuses, Run checks, expected-versus-observed table, a mismatch explanation, exact repair preview, approval/cancel controls, before/after report selection, progress/error states, and JSON report download.

Use isolated client development fixtures solely to inspect layout and all outcome states, conspicuously labeled Development fixture. Do not add a fake backend or predetermined production outcomes. Show allowed, blocked, mismatch, inconclusive, empty, loading, and error states. Keep fixtures behind a development-only switch defaulting OFF; do not put fixture wallet secrets anywhere.

Use existing dependencies, accessible labels, readable addresses with copy buttons, and simple CSS. Do not change server/shared/root files. Run typecheck/build. Tell me the URL and how to inspect the states. Do not add more features.
```

Gate: you inspect the dashboard; all information is legible; fixture mode is unmistakable. Real mode shows empty/unavailable data honestly. A disabled button awaiting backend is acceptable at this stage.

### 4. Checkpoint the UI and collect teammate readiness

```text
Run typecheck/build, then commit and push only the verified UI layout on ui. Do not merge other branches yet. Show git status and commit ID.

List the exact API endpoints and ledger signatures this frontend depends on, directly from our shared plan. Give me a short readiness checklist for teammate A and teammate B. Do not implement their missing work.
```

Gate/manual action: ask B for an API commit and A for a working ledger setup commit. They push branches and tell you the commit IDs and what actually ran. Do not overwrite their work with your agent's replacements.

### 5. Integrate teammate increments

```text
Inspect working tree, branches, and remote updates. Integrate teammate branches api and ledger into ui only when they exist remotely and the teammates have confirmed the increments are ready.

If local work is uncommitted, identify it and checkpoint intended work before merging. Fetch origin, inspect changed paths, and merge the ready branches one at a time. Preserve the agreed shared types, root setup, ledger ownership, and API ownership. Do not recreate modules merely because a teammate's work is missing.

If a substantive conflict concerns shared contracts or ledger semantics, show the conflicting choices and stop for team resolution. Do not blindly choose ours/theirs. Run npm ci if the lockfile changed, then typecheck and build. Correct ordinary import wiring within my integration ownership; coordinate substantive backend changes with the owner.

Report which commit IDs were integrated, checks run, unresolved dependencies, and the next smallest blocker. Do not push main yet.
```

Gate: branches integrated; shared code compiles. If branch names differ, substitute the actual confirmed names. If A/B are not ready, continue UI helper work or help them debug; do not claim integration passed.

### 6. Connect setup and polling

```text
Work in src/client/**. Replace the setup/account fixture path with the agreed actual API:
POST /api/sessions with approveTestnetSetup:true; then GET /api/sessions/:id.

Creating the environment requires an explicit user click approving fake-fund setup. Poll during setup/checking/repairing, show backend progress, and stop timers on completion/unmount/session change. Display returned account settings and network, not fixture values. Disable duplicate setup and other mutations while busy. Handle 400/404/409/500 and fetch failures with actionable messages.

No setup mutation should run automatically from React render/effects. Client refresh/server restart must show an expired/missing session clearly and offer user-triggered recreation. Keep seeds backend-only.

Run typecheck/build. Verify real setup if backend is ready. Otherwise identify the missing server capability, without falling back silently to mock data.
```

Gate/manual action: click setup; see actual accounts/progress; confirm the selected network supports credentials. This makes several real testnet transactions. The operator approves this fixed suite using fake funds; it does not need production sign-in or money.

### 7. Connect actual before-checks

```text
Work in src/client/**. Wire Run checks to the agreed checks endpoint with phase:before and approveTestPayments:true after explicit user action. Poll for the resulting report and render backend rows, hashes, result codes, validated flags, snapshot, and timestamps.

Never derive outcomes from actor names, never hardcode a red legacy row, and never classify a timeout as blocked. Show inconclusive distinctly. Display repair only when backend supplies a plan derived from evidence. Explain that intended policy differs from actual ledger configuration.

Run typecheck/build. If browser tools are available, execute the actual before workflow; otherwise provide precise manual steps and mark it untested. Report actual findings without altering policy or permissions to force a desired result.
```

Gate: real ledger evidence in three rows. Expected illustrative setup: valid succeeds, legacy succeeds unexpectedly, stranger denied. A missing mismatch requires ledger inspection, not a frontend color change. Use R4.

### 8. Connect approved repair and after-checks

```text
Work in src/client/**. Render the server-generated repair plan showing the affected address, treasury, network, and exact DepositPreauth Unauthorize operation. Clicking cancel must send no repair request. Require explicit confirmation to POST the stored planId with approved:true.

Disable duplicate submissions; show repairing progress. Success requires the backend's validated repair receipt, not an HTTP 202. On stale-plan 409, ask the user to rerun checks rather than retrying the old plan automatically. Then offer a separate user-triggered after-check run with phase:after and approveTestPayments:true.

Keep the before report intact. Show before and after, actual hashes/codes, and remaining mismatches/inconclusive cases. Add report download containing only public-safe data.

Run typecheck/build and verify cancel, confirm, and after flow where possible. Report untested cases honestly. Do not modify teammates' ledger logic to make it pass.
```

Gate/manual action: review and approve the specific testnet change. Actual after results should retain valid access and remove legacy access. Do not present a repair as complete if only proposed.

### 9. Review the complete product

```text
Perform a scoped review of the integrated GateCheck implementation. Read relevant frontend, API/policy, and ledger files. Do not add features or redesign working architecture.

Check:
- Expected outcomes depend on intended credential policy, not accidental direct approvals.
- Snapshots come from current validated ledger state with pagination when needed.
- Only validated authorization rejections count as blocked; malformed/funding/transport failures do not masquerade as a successful permission test.
- Revoked customer's test omits deleted CredentialIDs.
- Small XRP payments and comfortably funded accounts avoid the low-balance DepositAuth exception.
- Setup/payment/repair transactions are sequential per signing account, with bounded waits and validated receipts.
- API mutations require explicit approval and per-session locks.
- Repair uses the stored plan, affects only reviewed approval, and checks relevant state freshness.
- Fingerprints include authorization-relevant state, not continuously changing ledger indexes, timestamps, balance, fees, or sequence values.
- Wrongly changed permissions or changed credential validity invalidate the plan.
- Browser code, API payloads, logs, report exports, and Git history do not expose seeds/private keys.
- Production/demo paths cannot silently use fixtures.
- Restart/session loss and error states are clear.

Run existing meaningful tests, typecheck, and build. List issues by impact. Fix ordinary UI/integration issues in my owned files. Coordinate backend defects with their owners using exact file/function/observed behavior; do not rewrite their modules unilaterally. State remaining limitations. Do not call passing tests proof of all XRPL behavior.
```

Gate: no unaddressed defect that invalidates real payments, repair approval, secrets, or displayed evidence. Minor cosmetic issues can wait. Team members can patch their branches and you reintegrate using prompt 5.

### 10. Final regression and public repository

```text
Freeze features. Run a complete real isolated testnet workflow and capture a public-safe report: setup, before checks, reviewed repair, after checks. Reuse a funded session where valid; do not spam faucets. Identify all results actually tested.

Update README with install/dev/build/start commands, team roles, architecture, exact supported scope (direct incoming Payments), selected network, fixture behavior, restart limitations, known exceptions, and links to official docs. Explain this is not a production compliance guarantee or a full mainnet clone. Public docs contain no secrets.

Commit/push verified integration to ui. Inspect remote main before merging; preserve teammate commits. Merge reviewed integration into main and push without force. If main changed incompatibly, stop and coordinate. Provide final commit ID.

Verify reproducibility with a clean checkout/temporary directory using npm ci, typecheck, and build. Preserve the running demo environment. Fix only release blockers, not new features.
```

Gate/manual action: verify repository is public in a signed-out browser. Let teammates know which commit is final. Stop unnecessary agents from editing that release while recording.

### 11. Optional deployment only if time remains

```text
Assess deployment readiness without changing hosting services or creating paid accounts. GateCheck requires a long-running Node server for WebSocket jobs and in-memory test wallets. The built Express server serves frontend and /api together.

Give exact build/start/env instructions for a hosting service our team already has access to. Use an explicit testnet/devnet endpoint and never accept arbitrary mainnet endpoints or production seeds. Do not expose a publicly mutable demo backend without restricting operator access: other visitors could trigger jobs and disrupt the shared session. Keep our demo under operator control.

Do not deploy until I provide the hosting target and authorize it. If deployment cannot be completed quickly, preserve the working local demo and README. A live link is recommended, not required. Do not switch to a frontend-only deployment that cannot run the backend.
```

Gate/manual action: hosting account access, environment variables, port/start configuration, and operator access control may need you. Skip this entire step if it threatens video/submission. You can demo localhost in the video.

### 12. Prepare the submission materials

```text
Using the implemented and verified behavior, draft:
1. A concise project description.
2. A 110-second demo script with exact UI actions.
3. A README submission section with placeholders for the YouTube URL and optional deployment URL.
4. A final submission checklist.

Do not claim features that are incomplete or use simulated outcomes as real transactions. Explain that this is a reusable XRPL authorization dashboard with real testnet counterexamples and reviewed fixes, scoped to supported Payment flows.

Tracks: exactly one general track, Most Technically Impressive; sponsor track Ripple. Demo max 2 minutes, public GitHub repo, recommended deployment. Work built during hackathon and core real, not hardcoded. Submission at hackathoncompany.com/platform; allow 15 minutes. Do not submit forms or upload a video on my behalf.
```

Gate/manual action: you record, upload to YouTube (public or unlisted, not private), verify access without your login, add links, and submit by 5:00. Keep recording under 2 minutes. Trim actual waits transparently; do not fake results. Save submission confirmation. A README link alone is not submission.

## Teammate A: send these prompts sequentially

### A1. Verify network, then environment

```text
Read Task A, shared types, and this runbook. Work only in src/server/ledger/**. Verify the installed xrpl SDK supports required credential transaction types and that the chosen testnet/devnet enables Credentials. Use official XRPL docs, not guessed JSON. If unsupported, report the exact endpoint and error for the Ripple mentor; do not bypass checks with unsafe type assertions.

Implement createDemoEnvironment and readSnapshot first. Create five funded throwaway accounts. Enable treasury DepositAuth; credential-preauthorize trusted issuer/type; issue and accept two customer credentials; directly preauthorize legacy customer; revoke legacy credential only. Await and verify every mutation. Keep all seeds private server memory and never log them.

Read snapshot settings/credentials from validated state; no hardcoded statuses. Follow the frozen exports/types, report progress, and add a backend smoke runner printing only public evidence. Do not edit root/shared files. Request needed dependencies from lead. Push the first working environment increment on ledger.
```

Gate: supported network and actual validated setup. Stop and get mentor help promptly if temDISABLED, faucet failure, credential schema or acceptance problems occur.

### A2. Payments and exact repair

```text
Implement sendTestPayment and removeIndividualApproval as specified. Use tiny fixed XRP payments, sufficient reserves, sequential per-account submission, autofilled fee/sequence/ledger bounds, and bounded validation waits.

Valid customer uses its accepted credential ID; revoked legacy customer and stranger omit CredentialIDs. Map tesSUCCESS after validation to allowed. A validated authorization rejection maps to blocked. Malformed transaction, insufficient funds, unsupported feature, or transport failure is inconclusive for the authorization experiment, not evidence of permission denial. Preserve validated evidence from SDK errors when possible; no blanket catch->blocked.

Repair removes only the specified existing direct approval and verifies validated tesSUCCESS. Run setup -> before payments -> repair -> after payments. Print hashes, codes, snapshot and outcomes without secrets. Report actual mismatches honestly and push working ledger commit.
```

### A3. Ledger review before integration

```text
Review your module for credential acceptance flags, issuer/type matching, correct hex encoding and credential IDs, pagination, deleted credential omission, reserves, validation waits, duplicate submission, and secrets. Ensure actual snapshots reflect ledger state and revoked status is supported by prior issuance/revocation evidence rather than inferred solely from a missing object.

Ensure plain unknown actors with missing credentials are labeled none, and that report roles do not dictate outcomes. Preserve bounded supported scope. Run the real smoke workflow and provide lead commit ID, function export path, selected endpoint/network, evidence summary, and any unresolved limits. Do not edit API/UI ownership.
```

## Teammate B: send these prompts sequentially

### B1. Policy and API scaffold

```text
Read Task B, frozen types and endpoints, and this runbook. Work in your API/policy/server-index ownership only. Implement deterministic expected-outcome evaluation and API/session job structure first.

Intended individualExceptions is separate from actual ledger direct approvals. A valid accepted credential from configured issuer/type or an intentional exception yields expected allowed; otherwise blocked. Preserve inconclusive observations and derive findings only from actual evidence.

Define a private adapter interface matching A's agreed exports. Until their implementation is available, use a clearly separate test adapter for unit tests only; live unavailable calls return a clear unavailable error rather than fake successful jobs. Keep server compilable without overwriting ledger files. Implement explicit approval validation, status/progress, one job lock per session, and safe public serialization. Push first API increment to api.
```

### B2. Real ledger orchestration and repair

```text
Connect A's real ledger adapter after coordinating its import path. Implement asynchronous setup, three sequential checks, immutable reports, evidence-based repair generation, and reviewed repair execution using the exact API contract.

Clients send stored planId and approved:true, not arbitrary transaction JSON. Read fresh settings before execution. Fingerprint only stable authorization-relevant state: DepositAuth setting, relevant preauthorizations, trusted issuer/type, and relevant credential validity. Exclude ledgerIndex, snapshot time, balances, account Sequence and fee; normal ledger/payment activity must not automatically stale an unchanged plan. Recheck credential validity at execution time.

Validate correct phase transitions; after-checks require actual validated repair. Reject duplicate/stale mutation requests with 409. Keep wallet objects inaccessible to serialization, redact API errors, and clear private sessions on restart. Push working real-flow increment.
```

### B3. API/policy verification

```text
Run meaningful tests for missing approval, unknown session, job already running, stale repair plan, canceled repair/no mutation, exception versus accidental approval, validated denial versus inconclusive failure, and a changed policy outcome. Do not mirror implementation line-by-line or invent successful live outcomes.

Verify real API setup -> before -> approved repair -> after with A's adapter. Confirm rejection codes are authorization failures before labeling blocked; other ledger failures are inconclusive. Make failure states retryable where safe and never auto-resubmit an unknown-outcome signed transaction blindly. Provide lead commit ID, endpoint readiness, actual evidence and unresolved issues. Avoid UI/root/shared changes unless lead coordinates them.
```

## Recovery prompts: use only when needed

### R1. Installation/tooling failure

```text
Here is the exact command and error: [paste]. Diagnose whether Node/npm/Git is missing, PATH is stale, PowerShell policy blocks npm.ps1, installation failed, or dependencies conflict. Give the smallest fix. On Windows try npm.cmd where appropriate instead of changing machine-wide execution policy. Do not rewrite the project or install random global packages. Rerun the failed verification after the fix and report evidence. If installation needs me, tell me the exact official installer/action and pause.
```

### R2. Application/build failure

```text
Here is the failed command/browser action and exact output: [paste]. Fix the smallest cause within your owned files. Preserve shared types, endpoint names, and scope. Do not suppress TypeScript checks, use broad any casts, remove failing tests, or substitute fixtures. Reproduce first, then rerun the failing command and relevant existing checks. Explain the result.
```

### R3. Git merge/authentication failure

```text
Inspect git status, current branch, remotes and exact error: [paste]. Preserve uncommitted work and remote teammate commits. Do not force-push, reset --hard, or choose conflict sides blindly. Resolve routine nonoverlapping changes; show substantive conflicting choices for owner coordination. If authentication, invitation acceptance, or commit identity is missing, explain my required action without requesting secret credentials in chat.
```

### R4. Real outcomes differ from the demo story

```text
These are actual results: [paste public report]. Do not change expected outcomes or UI colors to fit the story. Determine whether current ledger settings, credential acceptance/issuer/type/IDs, direct approval, low-balance exception, wrong endpoint, or an inconclusive error explains them. Compare intended policy with validated state. Coordinate ledger fixes with A and policy fixes with B. Report a supported explanation, not an invented vulnerability. Rerun only after the relevant issue is fixed.
```

### R5. Backend pending/stuck

```text
The UI has shown [status] for [duration]. Inspect backend logs and the relevant job without printing secrets. Identify the last submitted hash and whether it validated before attempting any retry. Distinguish faucet waiting, WebSocket disconnect, validation timeout, locked job, and UI polling failure. Add a bounded failure/inconclusive state where appropriate. Do not create duplicate payments or silently reset accounts to show success.
```

### R6. Scope drift

```text
Stop expanding scope. Preserve correct completed work. We need only the testnet setup, actual before checks, overlooked direct approval finding, approved removal, and actual after checks. Do not build OPA, chat, production onboarding, escrow, DEX, lending, trading, or extra pages. Tell me the next smallest blocker to that exact workflow and address it within your ownership.
```

## Likely Ripple/XRPL issues and manual interventions

| Issue | How it appears | What to do |
|---|---|---|
| Required amendment unavailable | temDISABLED or unsupported credential operations | A confirms the selected endpoint; get the supported testnet/devnet from the mentor. Do not assume a docs page means every network supports it. |
| Credential issued but not accepted | Valid customer unexpectedly denied | Subject must submit CredentialAccept and it must validate. CredentialCreate alone is provisional. |
| Encoding/ID mismatch | Invalid credential fields, invalid IDs or failed matching | Use installed SDK/docs; CredentialType is hex-encoded; CredentialIDs are ledger entry IDs, not wallet addresses. |
| Faucet trouble | Funding errors/rate limits/no account | Reuse a funded session, wait for funding validation, request mentor endpoint help. Never buy real XRP for this MVP. |
| Reserve shortage | tecINSUFFICIENT_RESERVE / unfunded account / low-balance exception | Fund accounts sufficiently for account/object reserves. Read live requirements; do not hardcode assumptions. |
| Sequence/validation errors | Past/future sequence, expired transaction or pending submission | Serialize signing-account writes, autofill current fields, inspect submitted hash before retrying. |
| Rejection interpreted as generic exception | API fails when expected-denied transaction validates | Preserve SDK error evidence and validated authorization result; fees may still be charged. |
| Real repair always marked stale | 409 despite unchanged permissions | Exclude changing ledger index/timestamp/balance/sequence from authorization fingerprint. |
| Polling/port conflicts | Blank page, 404/ECONNREFUSED or endless spinner | Check actual URLs, proxy, server process, and selected port; do not kill unrelated processes. |
| Backend restart | Session missing, wallets unavailable | In-memory test wallets are gone; explicitly recreate a demo session. Do not restore stale public JSON as executable private state. |
| Devnet reset | Previously funded accounts/credentials vanish | Testing networks can reset; recreate and do not claim persistence guarantees. |
| Package/module mismatch | Vite, Express routing or ESM runtime error | Fix versions/module paths centrally; do not create a second package layout. |
| Teammate API differs | Undefined fields/failed imports | Coordinate shared contract before code changes. No unilateral renaming. |
| GitHub push blocked | 403 or sign-in prompt | Owner grants collaborator access; accept invitation and use GitHub sign-in. Do not paste tokens into prompts. |
| Public deployment unsafe/unavailable | Serverless timeout, missing sessions, other people triggering jobs | Prefer local video; if deployed use long-running server and restrict operator mutations. |
| Secret accidentally committed | Git history contains wallet data/env files | Stop publishing that content, tell team, replace affected credentials and remove exposure properly. Merely deleting latest file does not remove history. |

XRPL DepositAuth is receiving-side authorization, not general wallet protection. Our supported scope excludes alternate receipt paths and documented exceptions except those explicitly checked. Credentials attest issuer statements; the app does not verify real-world identity. Passing three cases is evidence for those cases, not a proof of full safety.

## Final human checklist

- You inspected the running browser; fixture banner is absent from the real demo path.
- You saw real before/after hashes and validated outcomes, with no invented findings.
- You know the selected testing network; no production seeds/funds used.
- Team agrees on final main commit; public repo is accessible signed out.
- Video <=2 minutes, YouTube link accessible signed out; incomplete features disclosed.
- Select Most Technically Impressive and Ripple; do not select both general tracks.
- Submit repo/video and optional live URL at hackathoncompany.com/platform by 5:00.
- Confirm submission saved before 5:15. Do not let optional deployment consume the required submission window.
