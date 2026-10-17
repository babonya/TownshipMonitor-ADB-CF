---
language: en-US
---

# Android ADB transport

`android_adb` selects original binary PNG capture (`exec-out screencap -d PHYSICAL_DISPLAY_ID -p`) and Android touchscreen input on display 0. The transport binds the ADB executable hash, selected connection serial, hardware serial, boot ID, primary physical display ID, display size and rotation. Township must remain foreground. An ambiguous primary display, changed identity or geometry blocks operation. Non-primary virtual mirror displays do not redirect capture or touch. Every executable tap/swipe derives from the canonical current game fractions; pixels alone cannot execute.

Use `node tools/android-adb-cli.mjs probe ADB_EXE SERIAL OUTPUT_JSON` to inspect an already authorized connection and save its original PNG. The phone's USB debugging dialog must be accepted by the user. Tango's direct Browser/WebUSB connection must release USB before Google's ADB server can own it. The current transport does not require Tango to remain open.

At a paused, owner-free, input-settled boundary, use `node tools/android-adb-cli.mjs bind SESSION_ROOT OUTPUT_JSON EXPECTED_REVISION device-UNIQUE_ID`. This retains authority, stops and evidence, invalidates old observations and clears the previous transport binding. A reboot, rotation or resolution change needs a new probe/binding; do not alter the phone's display to fit a PC profile.

Input rechecks current source, canonical pending action, epoch, percentages, stops and ownership. A per-device exclusive fence prevents concurrent adapters. A per-action dispatch marker prevents replay while an action is outstanding. After a canonical commit, terminal and evicted actions' matching dispatch files are removed; pending, issued, captured and unknown actions retain theirs. Unknown or malformed files are not silently discarded. Screenshots and registration evidence are separate and are not deleted by dispatch cleanup.

Both the Restart button and the guarded restart command preserve stops and permit old unresolved Android history to pass through owned shutdown. The replacement starts once per new GUI incarnation: it confirms previous owner exit and input idleness, retires this session's abandoned device fence, and records `superseded_on_restart` with an unconfirmed outcome. It never replays the old input or claims success. Original failure evidence remains within bounded canonical retention. Reconnect, Refresh and Start in the same incarnation cannot discard new unresolved input. Status without a delivery sidecar does not read historical continuity accounting.

Restart checks only local ADB input clients that target this device (or omit a device selector), plus remote input processes. Read-only ADB queries and explicit other-device clients do not block it. New device fences have process creation identity; an original legacy fence requires a positively absent PID and matching session serial/action. Active or unverifiable owners remain held.

Target inspection uses one read-only ADB shell session containing serial, boot, window geometry/focus and physical-display queries. Capture performs this inspection before and after one screencap: three ADB round trips rather than eleven. Executable hashes are rechecked when stable file identity changes. Capture timing includes the initial inspection. No second semantic screenshot or pre-input analysis is added.

SOM Send uses the shared two-tap send/skip sequence on Android and Windows. The adapter waits at least 100 ms, then rechecks target and canonical input guards before the second tap. Android uses one batched inspection between taps. A complete pair uses the 500 ms first-result floor; an incomplete or uncertain pair remains unresolved and is never retried. Swipes retain their bounded 200–2000 ms duration.

In Android SOM, transient foreground, connection/process-exit and read-only capture timeout errors retain the capture owner and saved stops, wait three seconds and recapture. Stop/cancellation interrupts the wait. Changed device identity, boot, geometry, executable or invalid inspection evidence remains a hold. This retry applies only to observation, never to input dispatch.

## Recognition scope

### Active image assets — 2026-10-11

At the user's request, 4,524 unused images (243,792,743 bytes) were removed from this implementation's `reference` and `tools` asset scope. Android SOM's active profiles, template/source-image closure, shared order-button originals, and explicit test fixtures remain unchanged. Product catalogue images and unused PC/legacy recognition images are no longer installed here. Code and JSON metadata are retained; `product-catalog.json` is still an import-time dependency of shared code, not the image source for SOM product comparisons. Historical documents and metadata may therefore point to intentionally removed legacy images. Do not restore them as an Android runtime requirement. Runtime captures, pending-input evidence, unrecognized-product evidence, historical candidate/backup folders, and the separate PC installation were outside this cleanup.

The fixed deletion plan, independent review, and completion receipt are under `C:/Users/djfal/OneDrive/문서/ChatGPT/Township/image-cleanup-20261011/`. Active code/assets matched the independently validated r2 package before deletion; all preserved file hashes matched afterward. No game input or runtime-state change was performed for this cleanup.

The mobile SOM profile registers the full 1544x720 display at rotation 90 from original ADB captures in `reference/som/android-1544`. After current town recognition, market/barn entry uses the registered full-game fractions `marketTap` (0.28, 0.56) and `barnTap` (0.52, 0.30), without building-artwork matching. The market point was moved inside the canopy on 2026-10-12 after saved town shifts showed the former point missing the building; fixed-candidate validation and activation evidence are in `artifacts/monitor-market-entry-20261012`. Missing town recognition or changed geometry supplies no fixed entry target.

Android shares the SOM recognition and decision policy: product crops include ready checks, red shortages and observed SEND lettering establish delivery readiness, and positive WAIT/SPEED UP lettering identifies refreshing orders. Missing SEND does not itself hide shortage or deletion evidence. There is no extra per-slot fulfilled/empty/unknown prerequisite, mobile-only absolute-error filter, or additional SOLD OCR route. The request-stage minigame detector uses helicopter title, cash reward and PLAY lettering. Mobile WAIT/PLAY wiring has saved/synthetic coverage; original phone positives for those screens remain a separate acceptance limitation.

Market purchases follow the user's initial-column exclusion policy, not coin-icon matching. Only the two original first-column slots are excluded; current observed position tracks them as the view scrolls. SOLD lettering, full-view coverage and the phone terminal plus/empty arrangement use the shared policy. Dealer, paid expansion and refresh controls are not purchase targets. See [SOM workflow](som-workflow.md) for current market reset rules and temporary working data.

Unexpected panels use current-crop CLAIM/X classification; geometric candidates alone do not authorize input. Products-missing and full-barn modals have their registered dedicated recognition. Full-barn recovery performs the current one-default-sale-per-allowed-tab policy and returns to helicopter work. Registration sources, limitations and dated installation evidence remain below. Android legacy mode and other geometries return `ANDROID_PROFILE_REQUIRED`; no mobile train/airplane registration is claimed.

## SOM parity correction — 2026-10-10

The fixed candidate, source/crop hashes, independent verdict, installation receipt and validation are under [Android parity work](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-parity-fix-20261010). The market terminal source is an original ADB frame; modal composites are labeled synthetic and never registered as phone originals. The shared workflow, percentage input guards and single Android Send are unchanged. Automatic purchase/deletion/default-sale acceptance is separate from saved-image validation. Read current runtime stops and ownership rather than inferring them from older installation records below.

Initial validation tests and evidence are under [mobile recognition work](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-recognition-20261010). The dated installation records below describe their original checks and stop snapshots; later corrections and operating state are recorded separately.
Validation covers raw PNG transport, canonical percentage tap/swipe, foreground/device/rotation changes, saved stops, replay, current-screen restart recovery and active-input exclusion, provider migration, and recognition isolation. Live checks and activation are separate from offline validation.

## Mobile recognition installation — 2026-10-10

The reviewed 65-file payload is installed and adopted as `aafb5ec9894aa5b2403db4186bec3f24bbf604fdce4865a771c72423abeb8ccb`. It contains 40 UI crops from 12 actual Android originals. The [installation receipt](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-recognition-20261010/installation.json) and [final independent registration review](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-recognition-20261010/validation/independent-review-v4.json) link the fixed candidate. Earlier v2/v3 reviews in the same folder cover the code, per-slot send protection and the market sign crop that remains visible behind the dealer bubble.

The installed recognizer, guarded percentage input and production result verification confirmed nine non-consuming actions: helicopter close, barn open, crops/products tab changes, barn close, market open, market scroll, market close, and helicopter open. The scroll changed the visible product list. An additional observed coin variant removed one false unknown-currency hold; the final profile recognizes all six complete cards in that retained result. No purchase, delivery, deletion or sale was issued.

The default Monitor capture/worker path recognized a fresh 1544x720 helicopter frame. That one-capture controller check used a read-only delivery sink; actual input/result verification is recorded separately in the two live-navigation reports. [Installed verification](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-recognition-20261010/installed-verification.json) confirms worker readiness and released ownership. Canonical revision 329650, both stops and the absence of pending input are preserved. The user restored the Avast-blocked D1 executable and added its exception; the restored file matched the pinned installation archive, and actual phone product comparisons passed. These checks do not establish a complete purchase-to-delivery or barn-full recovery cycle.

## Initial transport installation — 2026-10-10

The 18-file candidate and published Monitor binary were installed and adopted as release `b16e5c3c98ae5bf79d8036f35f618593973d7effd07f1302c9065fdd15908494`. The canonical session migrated to `android_adb` at revision 329650 with both stops preserved and no pending input. Source and binary backups, pinned manifests and independent reviews are under [the dated work folder](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-adb-20261010).

Live temporary-session checks opened and closed the helicopter panel and moved the town map in both directions, returning to the original framing. Each result was inspected and settled; no purchase, dispatch, deletion or sale was performed. Drag smoke comparison allowed only raster differences of at most 2 per RGB channel and mean below 0.5 in the currently reviewed ground region; no production recognition thresholds were changed. The installed Monitor controller then captured one 1544×720 phone frame, released its capture owner, issued zero game inputs and reported `ANDROID_PROFILE_REQUIRED`. See [installed verification](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-adb-20261010/installed-verification.json). This verifies ADB transport and Monitor integration, not mobile automatic recognition coverage.

## Current-screen restoration — 2026-10-11

Android SOM now uses the existing dependency-preserving retention policy, targeting at most 100 frames, actions and visits in canonical state. Required current/unresolved evidence can temporarily exceed the cap; stale history is not a lifetime ledger. Saved original screenshots and registration evidence remain separate. Restart and retention validation are recorded under [restoration work](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-retention-20261011).

## Complete current-screen restoration — 2026-10-11

The fixed candidate, independent tests, dispatch cleanup, read-only capture checks and actual native Restart button verification are recorded under [restoration evidence](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-intent-restore-20261011). Installation preserves pauses and grants no game-input authority.

## Four-column market drag and overlapping capture — 2026-10-11

Normal Android market traversal uses `675/734` of the current market view (675 px at the registered 1544x720 geometry), based on the original-screen calibration. Origin discovery and first-column exclusion retain their 30% overlap gestures. Market swipes use bounded touchscreen DOWN/MOVE events. At the endpoint, the same Android shell starts the original PNG capture in the background and waits 200 ms before UP. The 400 ms movement budget excludes shell/input-service overhead. Capture is requested during the hold; completion may occur before or after release.

The adapter awaits confirmed release and complete PNG/target validation before returning the input receipt. The next capture-loop iteration consumes that one buffered PNG, bound to the exact action, source, epoch, hash and endpoint receipt; it does not request a duplicate screenshot or add a post-release wait. An early image without this binding remains rejected. Stops discard the buffer, and release/capture failures remain unresolved without replay. Host timestamps record receipt of the device endpoint/release notifications, not a hardware capture timestamp.
