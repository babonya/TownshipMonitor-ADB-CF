---
language: en-US
---

The approved Android [operating recovery](som-workflow.md#operating-recovery)
supersedes older blanket result holds for completed input only. Preserve
per-visit purchase and per-recovery sale attempts, retire without success claims,
use current popup-close evidence and allow one bounded transient recognition
recovery. Stops, unknown dispatch and evidence-integrity failures remain guards.

The user's 2026-10-13 [completed Send correction](som-workflow.md#unconfirmed-completed-send--2026-10-13)
supersedes the blanket unconfirmed-input hold below only when the send/skip
receipt proves both taps completed and a fresh current town/helicopter screen
permits replanning after the result timeout. Retirement makes no delivery claim
and never grants replay permission. Incomplete or uncertain input remains held.

# MuMu Operator Contracts

## Mouse Interruption Recovery — 2026-10-09

The user's recovery policy distinguishes native dispatch from planning and
adapter checks. In SOM, a Windows adapter exception before the native input
invocation has in-process provenance and becomes `rejected_before_input`.
It is recorded separately from native receipts; serialized copies cannot be
reused to authorize settlement. Native zero-event rejection also supports
occluded swipes, unavailable pointers, changed geometry and unavailable/cloaked
windows when action, command, state, bridge, reservation, closed helper and
absent dispatch markers agree. The next decision uses a fresh observation.

A drag interrupted by user buttons, occlusion, window geometry, minimization
or cloaking can complete under the same closed-helper, inserted-event and
owned-button-release proof as pointer movement. The old drag is never replayed.
For the SOM helicopter Send/skip sequence, a matching receipt with exactly one
completed click and three inserted events permits omitting the optional skip
after pointer/button/window interference or skip-window expiry. The first Send
is not repeated. `completionReason = "send_skip_omitted"` retains the original
failure, dispatch marker and binding; result capture waits at least 1,000 ms.
Only the normal observed delivery result increments the delivery counter.
Explicit stop, partial insertion, missing cleanup, live helpers, unrelated
errors and conflicting evidence remain unresolved.

After the 15-second result deadline, ordinary navigation may be marked
`superseded_by_observation` only on a supported recognized current scene with
no moving view, popup, capacity warning or minigame. This outcome makes no
success claim and resets temporary planning before any next input. Recovery
from an unexpected barn uses its current close control. Unknown screens keep
observing every three seconds with `SOM_CURRENT_SCREEN_REQUIRED`. Unconfirmed
purchase, sale, Send, deletion and claim results retain the pending action and
observe with `SOM_RESULT_REVIEW_REQUIRED`; they never time out into an automatic
success or another input. A later valid result can settle without restarting.
The Monitor displays these waiting reasons through its existing status field.
Continuous SOM runs may renew observation segments for a sole issued/captured
result with a dispatch receipt; unknown or orphan input still blocks renewal.
Explicit finite runs retain their existing limit.

Temporary SOM capture failures from minimizing, cloaking, moving or resizing
the same window preserve the capture owner and retry observation every three
seconds, polling stop flags at the existing short interval. No failed capture
can schedule game input. The visible capture error clears after an accepted
frame. Changed process identity and unrelated capture failures retain their
existing handling; supported geometry must return before input can proceed.
These scoped recovery rules supersede blanket timeout/unknown-input statements
below. They do not recreate control processes, clear stops or rebind a game
window after its process has changed.

## Pointer-interrupted Drag Completion — 2026-10-09

The user's explicit policy treats `POINTER_CHANGED_DURING_DRAG` as completion
of the drag and continues normal work. The Windows adapter accepts the exact
swipe only after the native receipt proves all attempted events were inserted,
its owned mouse button was released, and the helper exited. The action, command,
state hash, bridge hash, timestamps and saved dispatch receipt must agree.
The adapter returns an issued receipt with
`completionReason: "pointer_changed_during_drag"` and retains the original
native failure. It never repeats the interrupted drag. Normal result capture
reads the current screen and continues planning; this is no purchase or
delivery success claim. Other errors and incomplete cleanup retain their holds.
This scoped exception supersedes blanket unknown-input handling below.

## SOM Input Scope — 2026-10-09

The user removed SOM pre-input recapture and semantic reanalysis. This scoped
exception supersedes the general immediate-preflight statements below only
for SOM. Original frame/hash/epoch bindings, native window checks and result
verification remain. See [single-observation input](som-workflow.md#single-observation-before-input--2026-10-09).

The user's fixed-layout market entry uses the configured game fraction after
current town recognition, without a market-building image match. Input uses
that observation and checks native geometry; the result must recognize the
market screen. See [fixed market entry](som-workflow.md#fixed-market-entry--2026-10-09).

Fixed-layout barn entry follows the same rule: `town.barnTap` supplies the
game fraction after town recognition, without barn-building matching, and
only a recognized barn result confirms arrival. See
[fixed barn entry](som-workflow.md#fixed-barn-entry--2026-10-09).

In SOM mode, `tools/som/input.mjs` records scoped `som_*` actions using current frame/hash bindings, percentage game coordinates, the owned capture lease, the source observation without a second capture/analysis, the native input permit and dispatch receipt. Its result observer confirms the current UI transition before another action. Unknown results remain unresolved and are not retried. Helicopter Send may contain the user's explicitly authorized one-time same-position animation-skip tap after 100 ms, with native guards between taps and separate completed-click receipt fields. This is one bounded action, not retry permission. The quantity/price/order-allocation proofs below remain requirements of the legacy action path; the user's [quantity-free policy](transport-play-guide.md#som-policy-update--2026-10-09) replaces them only for SOM. Action-specific first-result floors are 300 ms for SOM helicopter/market entry, 100 ms for SOM order selection, 100 ms after SOM drag completion (one result observation without stability comparison), and 500 ms after the completed helicopter send/skip sequence; other actions, including barn entry and sale, retain 1,000 ms. Unconfirmed SOM results become unresolved after 15 seconds; timing alone never confirms success. Saved stops, native window checks and ownership remain. The `set_workflow_mode` Monitor operation changes mode only while paused, owner-free and input-settled; it grants no resume authority. See [SOM workflow](som-workflow.md).

## Native Monitor Restart From Current Screens

The user's 2026-10-07 policy, reaffirmed for Android on 2026-10-11, supersedes the older unresolved-input restart prohibition for native Windows and Android Monitor startup. Android device-fence recovery additionally checks local ADB clients and remote input processes; see [Android startup](android-adb.md). A new GUI incarnation checks previous owners and native input helper exit, then marks unfinished actions `superseded_on_restart` while retaining original evidence and previous status. This makes no success, failure, delivery or stock claim. Unfinished temporary missions/rounds are retired without replay or accounting. Stops, management authority, delivery options and device bindings remain unchanged.

Startup invalidates old observations and market positions, discards old reading jobs and waits, and begins a fresh unknown scene. Orders, stock counts and temporary needs must come from new screens; no legacy inventory or completed-mission reconstruction is consulted. The new helicopter scene starts a new navigation chain without restoring old pin exclusions.

This transition runs once per GUI incarnation. Plain Connect without an incarnation, repeated Connect, status, Refresh, Start and running callbacks cannot discard new unresolved input. Native restart still waits for owned cleanup and refuses busy delivery/foreign ownership; unresolved history alone no longer blocks shutdown. State, capture and runner locks record host, PID, process creation identity and a unique token. Recovery requires proof that the original process exited, including a reused PID with a different creation identity, unchanged file identity/content and an exclusive recovery fence. State recovery verifies the canonical checksum, and native recovery verifies input-helper exit. Unknown/malformed owners, PID-less legacy locks or a live native helper still hold startup. Interrupted recovery fences are automatically retired only after every recorded recovery owner is proven exited. A newly and exclusively created numeric sibling protects cleanup; the whole fence family, protector and original lock identities/content are rechecked before deletion. Repeated cleanup interruption and orphan siblings without an original lock are recoverable. Canonical checksum and native input-helper checks still precede cleanup. Live, unknown, malformed or replaced owners/fences remain held; file age never proves exit. Current-screen restart examines orphan capture/runner fence families as well as original locks. Non-native sessions and active-session result verification retain existing contracts. This section overrides earlier blanket restart statements below.

## Recoverable Observation and Cache Holds

Supported native helicopter map changes start a fresh observation visit after pending results and owned missions are settled. The coordinator atomically invalidates previous order/owned-count observations and old pin exclusions, then reads a new original to rebuild shortages and continue normal work. Pin count, color or location changes are checked using the existing map comparison; unsupported source recognition or malformed selection history is not treated as a recoverable map change. This transition issues no input, preserves action evidence, and retains stop, ownership, current-frame and unresolved/orphan-input guards. Legacy sessions retain their previous behavior.

Transient recognition errors use fresh originals and increasing observation backoff, including owned result observations with an unresolved input. Recovery never retransmits the input. Stops and cancellation precede new work and reject late observations. Unsupported products/screens retain their relevant-change hold.

Mayor's Cup operation uses the current reward stage and unresolved stage inputs, not a lifetime action count. A proven pre-dispatch rejection permits a new source review; post-reservation zero-event evidence must bind the session bridge. A new event after prior claims requires a verified complete reward result followed by an accepted town screen before the fresh completed-event modal. Restart supersession or different PNG bytes alone grant no claim retry. Historical pinned incident audits remain immutable and separate.

Route memory is disposable observation data: malformed/checksum/binding failures discard the cache; missing or changed originals discard only affected routes/arrival indicators. Current observations rebuild it. Canonical state, stops, authority and input records retain their own guards, and unrelated filesystem errors propagate. Market preflight keeps static anchors and exact product rows, quantities, currency, price and buttons; decorative shelf gaps and outer viewport margins are excluded from scrolling checks. No blanket tolerance was added.

## Percentage Coordinates

Follow the [percentage coordinate contract](coordinate-contract.md). Missing or mismatched frame/viewport bindings and out-of-viewport targets hold input; never fall back to pixel-only execution.

Updated 2026-10-07. Follow the [delivery guide](transport-play-guide.md) for gameplay policy and the [current capability/evidence index](remaining-implementation.md) for installed, live-verified and unsupported scope. This document defines execution and evidence contracts; historical installation chronology is preserved in [the pre-maintenance archive](artifacts/document-backups/maintenance-before-20261005.zip).

Visual train/airport arrival recognition and guarded command restart are installed and adopted; [actual restart verification](artifacts/google-play-transport-visual-arrival-activation-20261005/restart-verified.json) preserves paths, stops, input records and effects. Future Monitor restarts were authorized on 2026-10-05. Automatic train/airport return OCR, airplane loading-countdown OCR and arrival-deadline routing are removed. Restart alone grants no game-input authority.

## User-Supplied Town Recognition

Use the [registered town recognition scope](remaining-implementation.md#user-supplied-town-recognition). A hardhat alone classifies town at the registered 1578x1268 geometry; facility targets, readiness and input authorization remain separate.

## Preparation Before Starting

Open or reuse [Township Monitor](apps/TownshipMonitor/README.md): chat-folder `Township Monitor.lnk` or `C:/Users/djfal/Documents/Codex/2026-10-02/task/Township/artifacts/TownshipMonitor/TownshipMonitor.exe`. If needed, pass `--root C:/Users/djfal/Documents/Codex/2026-10-02/task/Township`. Launch through `Start-Process -WindowStyle Hidden`. Offline edits/tests need no Monitor startup.

Connect the configured session and compatibility paths used by the installed build; read stops, worker ownership and pending input before assigning input. Do not remove another owner's locks. Once input is settled and authorization permits observation, inspect current orders and rebuild temporary shortages; no completed-order reconstruction or inventory-history settlement is a policy prerequisite. The native Monitor uses temporary current-screen allocation. The standalone legacy continuity CLI retains ledger compatibility dependencies; respect real unfinished-input/journal holds and never edit runtime files to bypass them.

Future program restarts were authorized on 2026-10-05. Prefer `powershell -NoProfile -File tools/restart-township-monitor.ps1` from the implementation root, or Monitor's **프로그램 재시작**. Follow [restart without Computer Use](apps/TownshipMonitor/README.md#restart-without-computer-use). The guarded path preserves configured paths and stops, waits for owned workers to exit, and refuses busy delivery or foreign/unknown ownership. Old unresolved Android/Windows history passes through owned shutdown and is abandoned without replay by the replacement's current-screen startup. Do not force-kill or retry an uncertain result. Restart grants no game-input authority.

Monitor automatically attempts **Start** once after its startup connection. Automatic startup runs observation only when saved stops, unresolved global/orphan input and producer ownership permit it; it does not clear stops or retry a held attempt. Manual **Start** retains its existing observation-resume behavior. Neither path launches Township or grants management authority. Reuse an existing producer. Management requires explicit `authorize_management` with `source=explicit_user`, `scope=transport_no_tcash`; authorization preserves stops. Check `readiness`, current window identity/geometry and unobscured input coordinates before live work. Native Windows pointer input does not require prior foreground ownership and does not call a focus-acquisition API; it verifies the actual window beneath each input point. A first click may only activate the window, so confirm the result before another input. Exactly one owner controls input; the manager issues no parallel device input.

Monitor **Start** connects supported helicopter observations to [continuing management](continuing-management.md) under existing approval and exclusive ownership. Its awaited callback prevents ordinary captures from overlapping action preflight or result capture. Do not invoke a separate coordinator while Monitor owns input. Read-only Connect/status/Refresh never start delivery. Busy callbacks hold restart; unknown input stops the owned producer while preserving source stops and unresolved-input evidence.

## Program Helicopter Path

On a town original, use `prepare_town_navigation` as a read-only check. It defaults to `offline=true`, `maxSteps=8` (maximum 12), and accepts `facilityKind=helicopter|market` plus an optional `searchId`. It returns current native candidates, an existing accepted GPT or program-exact current-visit target when present, or `needs_review`/`hold`. For example, pass this JSON as `REQUEST_JSON` to `node tools/mumu-cli.mjs ROOT request REQUEST_JSON`:

```json
{"op":"prepare_town_navigation","args":{"facilityKind":"market","searchId":"market-001"}}
```

After current-visit review, `town_navigation` requires `source=explicit_user` and `searchId`. It can issue only one existing reviewed tap or swipe, then returns `waiting_result`; confirm a new result before another request. Standard input ownership, management, stops, device/epoch and exact preflight guards still apply. Changed map/popup, unresolved input, missing review, repeated terrain, no progress, scene mismatch or step limit hold navigation. Offscreen market memory from confirmed real visits supplies current-to-reference ORB direction only, never old tap coordinates. The bounded spiral uses the current reviewed `town_scroll` box. Navigation produces no stock facts or invented action result, and unknown input is never retried.

```json
{"op":"town_navigation","args":{"source":"explicit_user","facilityKind":"market","searchId":"market-001","maxSteps":8}}
```

Town recognition is geometry-specific. The current 1578x1268 registration uses the user-authorized hardhat scene marker and separate facility candidates. Registered native market/town/helicopter transitions use their own program review and exact preflight/result evidence; an icon match alone does not authorize input. Legacy HUD/awning registrations remain separate. Unknown scenes expose `sceneDiagnostics`; unregistered views still require exception review.

`tools/mumu-cli.mjs ROOT request REQUEST_JSON` accepts a UTF-8 file or stdin (`-`). This standalone compatibility request starts one round on an already open supported helicopter screen in an authorized, unstopped session; the native Monitor uses its current-screen coordinator:

```json
{"op":"helicopter_round","args":{"source":"explicit_user","roundId":"heli-next-001","inventoryRoot":"RUNTIME_INVENTORY_ROOT"}}
```

The round matches supported slots/products, reads owned/required pairs, calculates current shortages, and processes feasible deliveries or policy deletions before navigating to other visible locations. Pins provide geometry only; products and required quantities identify orders. Keep current visit state only while needed to verify an action. A later visible equivalent request is current work without consulting completed-order history. A round ends when no further supported work remains; input/order counts and elapsed round time do not impose an end. Recognition-only uncertainty holds affected orders, while unresolved input/results block all input. Individual recipes retain their limits and supported transitions.

`observe_helicopter` reads a specific/latest original and can commit scoped `program-helicopter` facts. For read-only use, follow [saved-image inspection](#saved-image-inspection). Generic matching/OCR candidates and `program-exact` reuse retain separate provenance. Program proof binds original/hash, profile, recognized fields, facts and targets; changed facts/assets reject input.

The active provider profile defines supported physical geometry and products; see the [current native scope](remaining-implementation.md#installed-native-scope). Legacy ADB recognition uses English 1600x900 originals; native Windows recognition uses its registered physical viewport and reference fractions. Unknown products/layouts, unread digits or check/count disagreement hold delivery while independently known fields can inform the temporary needed-goods list. Merged/uncertain map pins abstain without blocking other supported orders. Never resize coordinates or force product IDs. Faces, portraits and dialogue are excluded from recognition and delivery approval.

Program SEND preflight requires exact anchors, button target and `order_grid` pixels, excluding customer imagery/dialogue. A changed requested-product signature after the verified input can confirm delivery even when the game selects another order automatically. Identical lists, unchanged images, wrong epochs or unproven results hold input. After confirmed delivery, read affected owned counts again when needed; fabricate no quantities, coins or free space. Any product with a total requested quantity of at least 8 units makes the order deletion-only. A calibrated trash target uses the same exact order grid; a verified changed list or high-confidence exact `New order in: MM:SS` panel with no trash button can confirm removal. The latter text path has no saved live cooldown original yet and remains subject to strict evidence guards; unrecognized results stay pending. Confirmed deletion removes that order from the temporary needed-goods list; it does not imply a stock, coin or capacity change.

### Saved-Image Inspection

Pass this request as a UTF-8 file or stdin (`-`) to `node tools/mumu-cli.mjs SESSION_ROOT request REQUEST_JSON`, using a session that contains the saved original:

```json
{"op":"observe_helicopter","args":{"frameId":"latest","offline":true,"commit":false}}
```

This reads the saved original without a new game capture, committed review or game input. Replace `latest` with a saved frame ID when needed. `offline=true` with `commit=true` is rejected. `helicopter_round` has no offline mode and may issue game input when its authority and guards permit; use it only for authorized live work, never as a saved-image check.

## Program Train Paths

At the current 1578x1268 capture, the 1114x735 loading and returned-cargo registrations do not establish execution support. See [geometry and evidence boundaries](remaining-implementation.md#geometry-and-evidence-boundaries) for the separate idle observation scope and exact missing loading evidence.

Use the [current capability/evidence index](remaining-implementation.md#installed-native-scope) for installed native rows, selected load results, partial reentry and remaining limits. Legacy ADB load/departure evidence is listed separately there and does not extend native coverage.

`observe_train_rewards` supports saved-image inspection with `offline=true`; observation grants no input. Registered protected returned-cargo routes retain current source geometry, input ownership, immediate preflight, a result at least 1,000 ms later and same-row/slot transition proof. The native whole-row swipe is one guarded input with one immutable protected receipt; no numeric quantity is inferred. Collect all returned cargo before loading. Unknown cargo or results stay held. A confirmed full-barn failure needs evidenced capacity, ordinary surplus after reserves and a supported sale/return route; never replay unchanged collection or sell protected cargo.

`observe_train_loading` and scoped `program-train-loading` recognition establish supported current products, required counts, selected details and loaded states. Re-read enough of the current order to apply policy and determine remaining work. Missing historical full-demand records alone do not prohibit loading; unread current policy-critical quantities hold only the affected order. The independent-slot path needs current whole-order policy evidence. If loaded-slot quantities are hidden after restart, hold that order; do not invent the missing demand or require a historical archive merely because it once existed.

A `load_train` action requires a verified current order, selected slot/item/required quantity, target and displayed owned count, with shared-goods commitments respected. Confirm that the selected carriage loaded; then refresh remaining needs from current evidence. Moving or unexplained results retain pending input without replay. Final automatic departure requires a supported result transition and cannot be inferred from sufficient stock or a loaded checkmark.

After the user explicitly confirms manual loading and departure, `reconcile_external_train` can supersede a sole unknown finite train-load action while both source stops are set and no input owner exists. It requires matching current in-transit row evidence, an exact source revision, preserved original/preflight evidence and the affected mission. It saves an exclusive original resolution record, retains the original input outcome as unknown, records no delivery or numeric debit, invalidates old observations and prunes only the obsolete row references. Exact retries validate the entire resolution, action and terminal mission before completing a partial sidecar sync. It never resumes gameplay or automatically resolves unknown input; see [validated scope](artifacts/external-train-resolution-validation-20261004/verdict-v2.json).

## Minimal Verification and Record Flow

1. Read current orders and displayed owned counts; build temporary needs without a barn snapshot or historical inventory reconstruction.
2. Use the supported program path for normal recognition, necessary purchases, order handling and result verification.
3. For an exception, inspect the exact original via `prepare_review` and retain truthful provenance. Read-only preparation uses `pin=false`; default preservation uses `ocr=false`.
4. Issue one supported action with current target, policy, ownership and shared-goods checks. Use the scoped first-result delay above; unlisted actions retain at least 1,000 ms after input completion. Input API success or an unchanged panel does not prove fulfillment.
5. Confirm the result before the next input. Retain source/preflight/result evidence while an input is unresolved and for a specific validation case; completed-order and stock-history archives are not required to continue.

Stops, unknown input, changed targets, external invalidation and contradictory current evidence block the affected input. Never retransmit an uncertain action or clear another owner's lease. Direct device input remains outside normal program operation and requires a separately authorized exception boundary.

Use supported reconciliation for an actual unresolved or rejected input. A rejected-before-input action requires proof that no input was attempted; it creates no delivery or stock effect. Existing APIs such as `reconcile_transport_rejection`, `resolve_observed` and `reconcile_external_train` retain their exact proof and ownership checks. This documentation does not widen their scope.

The 2026-10-07 [viewport-rejection recovery helper](artifacts/viewport-rejection-resolution-20261007/resolve.mjs) is restricted to the exact historical `open_helicopter` action and its hash/revision-bound request. It verifies canonical target/command, source/preflight originals, both stops, absent owners and dispatch records, and the unchanged installed code; it reproduces the synchronous viewport rejection through a runner that cannot issue input. After [independent validation](artifacts/viewport-rejection-resolution-20261007/independent-verdict.json), the supported state transaction preserved the complete original unknown record and reconciled the action as `rejected_before_input`, invalidating old observations without changing stops or stock. This is no general unknown-input resolution or retry authority; conflicting evidence, changed state or an orphan resolution file holds recovery. The [capability index](remaining-implementation.md#policy-and-installation-status) records the dated applied result; future execution still requires valid viewport bindings and existing startup guards.

Use `adopt_release` only at the supported settled boundary with the existing configuration and exact old/new release identity. Do not clear runtime state to make adoption pass. Restart afterward when needed under the standing restart contract; installation does not resume gameplay.

## Item Lifetimes and Recapture

Temporary observations remain usable within the current work until a relevant change. Original capture times never change when evidence is reviewed or copied. Image age alone does not require another GPT review, and unchanged shortages do not justify repeated visits.

Purchases, deliveries, manual changes and a restart require reconsidering affected current orders. After restart rebuild the working list from current screens once input guards permit it. Read capacity separately when needed. Train/airport timer OCR and arrival-deadline routing remain removed.

The installed `invalidate_observations` operation retains its `source=explicit_user` and reason requirements and preserves stops/input. Compatibility synchronization is an implementation detail, not a requirement to maintain a persistent stock ledger.

## Target Verification and Exceptions

Preflight retains device/package, original/hash, epoch, target, critical facts and reservation revision. Anchors and critical-region geometry never move; critical pixels remain exact. Reflective interiors may use verified `target.verification`: at most 3% changed pixels/channel tolerance 12, at least 15% target coverage including center. Optional common motion stays within 10 px, correlation 0.97, mean delta 12, texture standard deviation 10, and area 16,384 px.

Critical fields: purchase `price`, `quantity`, `currency`; load `stock`; sale/received receipt `quantity`; program SEND/deletion `order_grid`. Management targets require `purpose=transport`, `verified=true`, `currency=NONE|COIN`. Purchases additionally bind a current verified ordinary order and requested item, excluding deletion/held orders. Production, planting and harvesting remain forbidden even under legacy approvals. `collect_product` is restricted to the supported `received_products` receipt and confirmed quantity. Installed guards reject coupons, dealer operations, T-cash, protected sales and unsupported consumptive navigation. The [recorded barn-recovery exception](transport-play-guide.md#barn-recovery-policy) requires validated implementation before construction-sale execution; do not bypass the current guard.

For visible `train_skin`, do not infer an order through the obscuring panel; allow only reviewed close navigation and recheck the current train afterward. `received_products` requires explicit `receiptDismissed=true` and an actual town result. Launch/unknown-launch reconciliation retains existing lifecycle commands, fresh original/foreground and explicit authorization; it cannot settle ordinary unknown input or clear stops.

After an unfamiliar product is confirmed from original/detail evidence, record its ordinary catalog ID and slot in an actual GPT exception review. `learn_helicopter_item` requires `source=manager_exception`, exact `frameId`, `slotId`, `itemId`, and a distinctive `cropBox` inside the slot. It stores a hash-bound variant; generic candidates, protected products and flat crops cannot train identity.

Present preflight evidence must retain its canonical original path, PNG hash, dimensions and metadata. The stored command must equal the target-derived tap; helicopter claims must agree with source-owned counts. Conflicts remain held. Early known zero-input rejection without a recorded preflight retains its existing explicit reconciliation path.

## Generated Action IDs

New order IDs use two-letter transport categories: helicopter `hc`, train `tr`, and airplane `ap` (both internal `plane` and `airport` names). Related native action IDs start with that category, followed by the existing frame sequence in base36, a one-letter action group and reviewed target position in base36; for example, `hcg6n-h0`, `trg6n-l0`, and `apg6n-l0`. Non-transport actions keep their generic compact format. Category labels do not change internal transport names, product/quantity identity or priority.

A retained collision receives the next free short suffix. Retained requests reuse their exact existing ID, including older formats. Existing order contexts retain their original IDs, and proof validators accept the old prefix only with the same exact origin and dependency checks. Full request-digest checks still run under the state lock before input; IDs grant no authority. No deleted-ID index, history or additional counter is stored. Existing evidence is not rewritten. Standalone legacy action callers and explicit external request IDs retain their existing contracts.

## State Record Limits

Native current-screen `state.json` uses compact JSON with the existing atomic replacement and checksum checks. Each save keeps at most 100 full frame records, 100 full action records and 100 visit records, selecting recent history only after preserving current orders, unresolved input, active mission/round proofs and consumed event/selection budgets. Current scene and transitive frame/action/visit references are protected together. Required source/result dependencies may reduce the number of retained terminal actions below 100. Protected proof alone exceeding a limit is reported by `retention.overflow`; it is never silently discarded. Legacy historical-accounting sessions report `LEGACY_HISTORY_REQUIRED` instead of pruning their journal.

Older unneeded frame/action/visit metadata is deleted without an archive, deleted-ID index or tombstones. Existing retained-action duplicate checks and current-frame/epoch/input guards remain in force. Stops, management authority, sequence/startup cutoffs and current owned-count semantics remain unchanged. Missing deleted history does not authorize replay or inferred stock.

### Capture and product evidence image limits (2026-10-12)

Native Windows and Android SOM keep up to 100 ordinary `frames/frame-*.png` images. Cleanup runs after a successful state commit under the existing lock, on the first save and when the capture sequence changes. Retained state proofs and current SOM need-image source frames take priority; the remaining slots retain the newest captures. Cleanup includes older orphaned PNGs. Registered originals referenced by registration JSON remain permanent assets outside the disposable capture limit. Active dependencies exceeding 100 are preserved and reported as overflow, never discarded to satisfy the count. The latest capture cleanup report is `.monitor/image-retention.json`; errors cannot invalidate an already committed state transaction.

Unregistered helicopter tooltip evidence and `observations/` share a separate budget of 100 PNG images, counting crops and full originals together, not 100 products. Product saves and observation collection/reuse retire the oldest whole bundles: source, item/name images and metadata stay together. A three-image tooltip bundle therefore allows at most 33 ordinary bundles (99 images). The bundle being written, pending collection/recovery and registered bundles/originals are protected; unreadable/rejected inactive evidence can expire. Registered recognition assets and their required originals remain outside this disposable evidence limit. Cleanup handles only known file layouts and never follows directory links or recursively removes unknown contents. A protected overflow or file failure is returned in the collection retention result. These limits do not affect current in-memory SOM product comparisons, purchase/result checks, registration identity or game-input authority.

## Validation

Program idle scheduling is distinct from `observationWait`'s existing explicit GPT timer contract. Only an exhausted helicopter round with accepted current evidence and settled input permits 10-second checks and, after two unchanged checks, 30-second checks. The canonical coordinator hold remains authoritative. Supported helicopter cooldown events and meaningful local/visible changes trigger observation or reconsideration, never input authority. Train/airport arrivals use registered visual changes. Mandatory preflight/result evidence and short stop/input/ownership polling are preserved.

Installed observer renewal treats the default Monitor budget as 900-frame segments within one lease, retaining matcher/delivery instances, absolute schedule and result IDs. `continuous=false` keeps a finite budget, and smaller explicitly bounded starts remain finite by default. Stops, unresolved/orphan input, transition, changed session/policy, shutdown/cancellation or busy delivery prevent renewal. This observation contract neither grants input nor repairs unknown input; [the current index](remaining-implementation.md) records its installed scope and historical evidence.

An explicitly requested settled release installation may use `adopt_release` while paused; it preserves both source stops and unresolved-input evidence. Adoption rejects any active capture lease and unresolved input. This paused installation path grants no resume or game input. Use Monitor **프로그램 재시작** afterward; do not press **Start** to clear an existing stop as part of installation.

Follow the [validation policy](AGENTS.md#simple-improvements-and-validation) for case selection, document checks, test scope and stopping conditions, and the [delegation rules](AGENTS.md#delegation) for independent validation. Use saved originals and temporary sessions/fake devices for behavior checks.

The full-suite commands `node --test tools/*.test.mjs` and `.venv-perception/Scripts/python.exe -B -m unittest discover -s tools/township-perception -p 'test_*.py'` are available when the validation policy justifies broad checks. Record the reason for expansion.

Retain the previous working version and activate only at a settled boundary with no pending/unknown input. Measure live speed only in a separately authorized run. Keep relevant validation evidence and settle only this topic's TAPL work in the shared run.
