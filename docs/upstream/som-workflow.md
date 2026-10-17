---
language: en-US
---

## SOLD observations count as search completion — 2026-10-14

The user treats a verified current all-visible-cards-SOLD screen as having
finished the market search. MarketVisit binds requested images before its
existing SOLD exit and passes this observation into its existing finish logic.
That path bypasses earlier scan.complete and separate right-edge/terminal
requirements; ordinary complete scans retain their prior evidence checks.
Only unattempted known products count, once per visit. Session changes,
unknown offers and uncertain product matches still defer affected evidence.
A scrolling proposal alone does not finish a visit, and the completion flag
is replaced at the workflow boundary for every current observation (including
popup and barn routes), requires the visit's existing market scope, and is
cleared after finish. No new
SOLD input or traversal policy is introduced. Two search failures OR two
confirmed purchase-return shortages independently register the original crop.
[The current policy](adb-order-deletion.md#decisions) supersedes the historical
full-scan-only restriction in the section below.

## Independent two-failure conditions; SOLD behavior restored — 2026-10-14

In the same Android SOM market refresh period, either two completed verified
not-found searches OR two confirmed purchase-return shortages register the
original requested product as failed. The counters are separate; one of each
does not qualify. Purchase-shortage evaluation was retained throughout the
not-found counter change. Both counters persist in the existing checkpoint
and clear with the market session.

The user requested reverting the SOLD-page traversal change. MarketVisit now
uses its exact previous SOLD exit/scroll and need-preparation order; its only
change from that version is passing the visit ID into completed-search counting.
A clipped SOLD card does not prove more purchasable goods remain. Existing
full-search coverage and uncertainty guards still apply. See
[the common-session policy](adb-order-deletion.md#decisions).

## Requested quantity limit restored — 2026-10-13

The user's latest correction restores Android SOM deletion when any current
helicopter product slot requests at least eight units, regardless of owned stock.
Apply this before ready delivery, failed-product review and shopping. Seven is
eligible. Exclude the entire affected order from shopping, including when deletion
is deferred. Use current hash-bound readable OCR and current trash geometry; the
common fifteen-minute timer and all existing input/result guards still apply.
Unknown timer uses the existing timer-only market visit. This supersedes historical
statements below that removed the numeric limit. Windows SOM is unchanged.


# SOM helicopter workflow

## Operating recovery

The approved 2026-10-13 Android SOM recovery separates completed native input
from successful game results. Minigame handoff and keepalive retain their current
behavior. `motionPending` consumers remain unchanged; no new motion classifier
is introduced. This section supersedes older blanket result holds only for the
completed Android actions described here.

### Completed actions

After the existing 15-second result timeout, a fresh bound observation can retire
an issued/captured action as `superseded_by_observation`, outcome `unconfirmed`,
when its own receipt proves all planned taps finished. Pending, partial, unknown
or mismatched input remains held. Source/profile/epoch/ownership, stops and
percentage coordinates remain mandatory. Retirement makes no inventory, order
completion, reward or delivery-count claim. Completed Send keeps its separately
documented `replanned_from_current_screen` outcome.

An unconfirmed purchase consumes its existing market-visit attempt without
registering a confirmed purchase or contributing to purchase-shortage failures.
An unconfirmed deletion discards temporary survey decisions and uses the current
order and current deletion gate. An unconfirmed sale handles that allowed tab
once for the current recovery and moves to the remaining tab or delivery without
claiming freed capacity. Purchase and sale attempt limits survive recovery.

CLAIM suppression applies to the same visible popup encounter. The worker keeps
a verified X from that same current popup when available. Recovery uses that X,
not CLAIM again, with at most one recovery close proposal per encounter. Ordinary
unconfirmed popup close gets the same bound. An observed non-modal departure
clears the restriction; changed header bytes do not. Missing close evidence and a failed
recovery close become explicit exceptions. Helicopter product-information
collection retains its own separate close rules.

### Current navigation

Invalid market drag alignment is recalculated from current geometry while
retaining original excluded slots and visit purchase limits. If no valid drag
can be formed, one fresh additional observation precedes a current close-to-town
exit. Early exit never proves market exhaustion or absent products; retain the
common refresh-period timer and failed-product policy.

A completed or unusable order route leaves through the current close target
after current readiness and shortages are evaluated. A readable current shortage
can create shopping needs without a recognized pin; failed/deferred orders cannot
enter that fallback. Current readiness cancels a not-yet-entered shopping plan
and takes delivery priority. Unseen orders stay unconfirmed. All-refreshing
town/helicopter navigation remains intentional.

A mismatched barn recovery exits using current close evidence and abandons its
stale recovery and barn destination together. The next town observation selects
helicopter. An unsolicited recognized barn screen also exits. No close target
means `SOM_BARN_CLOSE_REQUIRED`, not invented input.

### Recognition and presentation

One transient vision-process or loopback-service failure may recover per episode,
bounded by 15 seconds and cancellation. Keep the worker object, input binding,
dealer state and owner connected; replace only a failed vision process. Ignore
late old-process events, discard failed matching results and wait for a fresh
observation. A successful observation ends the episode. Repeated failures and
integrity errors pause explicitly. User stops cannot be cleared by recovery;
cleanup never waits on the matcher's own active drain callback.

Filesystem errors in disposable shopping images, delivery status and perception
display caches emit presentation errors without suppressing a valid current
decision. Original captures, canonical input proof and data validation keep
their existing failure handling. Two fresh observations without a supported
target produce an explicit current-screen/target exception. No current close
target authorizes no recovery click.

## Unconfirmed Completed Send — 2026-10-13

The user's 2026-10-13 correction separates a completed helicopter input from
proof of a successful delivery. Keep the existing first-result floor and
15-second result timeout. If normal result recognition cannot confirm Send after
that timeout, a receipt bound to that action must confirm both planned send/skip
taps completed, with a valid completion timestamp and the registered two-tap
sequence. Only then may a fresh, bound, recognized town or helicopter screen
without motion or a modal retire the old action as `superseded_by_observation`
with outcome `replanned_from_current_screen`.

This is neither delivery success nor failure and does not increment the daily
delivery count or invoke its completion callback. Discard temporary survey and
shopping decisions, retain the common market refresh-period policy and dealer
cooldown, and plan once from the same observation. Town reenters helicopter;
the helicopter panel uses its current order and current readiness. Never replay
the old input coordinates. Partial, pending or uncertain dispatch, unidentified
screens and motion retain the hold; source/profile/epoch bindings, stops and
exclusive input ownership remain enforced. Normal confirmed delivery behavior
is unchanged. This scoped rule supersedes the blanket unconfirmed-result hold
below for completed Send. Other completed Android actions now follow
[operating recovery](#operating-recovery); Windows keeps its existing scope.


## Market-session restart reuse and failed-product display — 2026-10-14

Android SOM saves its current market session atomically with a checksum. A restart
within three minutes of the last successful save reuses its timer, product crops,
failure counts/flags and confirmed pending purchase evaluations. Normal shutdown
saves again; a forced shutdown uses the last successful checkpoint. Missing,
unreadable, invalid, mismatched, older or market-expired checkpoints start fresh.
Orders, active visits, unread retries and inputs are not restored. The next market
entry rechecks the existing timer. See [canonical policy](adb-order-deletion.md).

The required-goods interface shows active failure crops in a separate `실패 상품`
section with the failure reason in its tooltip. It reuses the existing temporary
image manifest/cache. Temporary failures disappear when the active market session
expires or is reset. The two [permanent user exclusions](adb-order-deletion.md#permanent-user-exclusions---2026-10-14)
remain visible and excluded across sessions and restarts. Archive-only failures
from old sessions are not included. This scoped
policy supersedes older statements below that discard all market state on restart.

## ADB common market session and deletion — 2026-10-13

The canonical [ADB deletion policy](adb-order-deletion.md) defines the approved
algorithm, per-entry timer OCR, common refresh-period state, requested-product
failure comparisons and the inclusive 15-minute deletion gate. It supersedes
the old Android 30-minute market-return reset and unread-order deletion veto
described in the historical sections below. Ready orders still take priority
except for the two permanent user exclusions;
current source, percentage geometry, owner/device and result guards remain.
The 2026-10-13 followup removes all ready-crop/stock-consumption inference and
sets purchase-shortage failure registration to two episodes (first defers),
following the user's 2026-10-14 threshold update.
Windows SOM retains its existing market-return reset. See the capability index
for validation and activation status.

## Readable orders survive missing selection markers — 2026-10-13

An unread sibling order no longer vetoes the whole market-return recheck. Its
current quantities still must be readable before it can be deleted. After the
best-effort recheck, the deletion phase can revisit a visible untried location
even when no selection marker bound that location to an order. Navigation alone
never authorizes deletion: the resulting current panel must supply the existing
shortage, trash, frame/hash and free-refresh proof. This avoids leaving a final
refreshing panel without revisiting readable orders. Ready-order priority,
the 30-minute threshold, per-phase attempts and the two-pass limit are unchanged.

Saved Android screenshots and six focused regression tests passed independent
review. Counterfactual one-hour timers test the defect; they do not establish
historical deletion eligibility before the retained runtime window. Evidence:
`C:/Users/djfal/OneDrive/문서/ChatGPT/Township/market-reset-investigation-20261013/`.

## Bounded Return Rechecks — 2026-10-13

After a market visit, attempt each order location at most once per phase in each of two helicopter-panel recheck passes. Count selection proposals before dispatch so a pre-input rejection cannot repeat indefinitely. Skip pins without an unambiguous finite marker body of at least 10 by 10 pixels; do not send those locations to the input executor. Continue other readable orders, then return through the currently recognized close target. Only a confirmed return to town advances the pass count. After two passes, discard this optional market-reset recheck and resume the ordinary current-screen survey. Skipped orders remain unconfirmed, never completed. A missing close target only reobserves; elapsed time does not replenish selection attempts. Pending/unknown input, current percentage geometry, free-refresh timing, readiness and deletion-result guards remain enforced. This limit supersedes unlimited town-reentry retries described below.


## Partial red-pin recovery — 2026-10-12

The Android 1544x720 helicopter recognizer supplements existing pins with paired
side-border templates from a hash-bound original game screenshot. The lower
V-shaped tip is not required. Existing detections take precedence within the
registered duplicate radius; recovered pins enter the existing fractional
order route at their observed centers. No new input or result pathway is added.
Red recovery does not alter existing green pins, order amounts, refresh state,
SEND gating, or scene detection. Clock pins remain refresh candidates, never
deliverable orders. Selection failures retain the existing best-effort behavior.

Frozen-parameter offline review of 23 additional screenshots covered 207 visible
pin instances: existing detections covered 121 and the combined set 182. Of the
61 additions, 34 were ordinary pins and 27 were refresh clocks. This correlated,
appearance-selected sample is not an operational accuracy estimate. Some deeply
occluded pins remain missed. Source evidence and installation status are in
`C:/Users/djfal/OneDrive/문서/ChatGPT/Township/partial-pin-install-20261012/`.

## Helicopter product crop — 2026-10-12

The installed Android 1544x720 registration expands all six helicopter product
crops only at the left edge: 94x65 becomes 113x65, using percentage coordinates.
Top, bottom and right edges retain all original artwork. Continue original-color
individual D1 comparisons and bounded market reuse; do not apply white masks,
bottom trimming or the multi-image exclusion prefilter from the experiments.

Independent saved-image validation preserved every original pixel in 174 crops
from 30 frames and left quantity, order, refresh, button and pin outputs
unchanged. Unchecked matching examples passed 18/18 same-product and 24/24
different-product trials for both old and expanded crops. This supports artwork
preservation without an observed regression, not an accuracy or speed gain.
Two pre-existing JavaScript refresh fixture failures are recorded separately.
The actual Android worker subsequently emitted all six 113x65 crops under the
new profile hash. Installation and guarded restart preserved saved stops; the
final read-only runtime check was paused.
See the [fixed evidence and activation status](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/d1-order-left-crop-20261012/REPORT.md).

## Market quantity-overlay reuse — 2026-10-12

Within one market visit, the existing strict artwork comparison can ignore the
quantity overlay in the registered 1544x720 Android capture layout. The excluded
region is the intersection of x >= 0.40 and y >= 0.65 of the product crop; the
lower-left artwork remains compared. Both aligned images exclude that region.
Full PNG crops still go to D1, and purchase coordinates and result checks remain
unchanged. Other providers, dimensions and missing bindings use full artwork.
The existing bounded image memory clears on profile, viewport, market view,
provider or capture-size changes, changed needs, and visit completion.

Saved-image replay retained all 57 actions while reducing pairwise attempts from
1612 to 1477. An initially empty persistent product-choice cache across both
saved visits yields 1268 versus 1139 unique requests (10.2% fewer); these are
offline estimates, not live request or elapsed-time measurements. Reviewed
market examples covered 5005 different-product pairs with no false reuse.

The proposed binary any-needed-product prefilter is not adopted. Expanded
cross-screen checks found repeatable false negatives for potato, cork and
wallpaper even when the original pairwise method returned same_product. Keep
the existing individual comparisons. Fixed-candidate evidence and installation
status are in [the optimization directory](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/d1-call-optimization-20261012).

## SOM text decisions — 2026-10-12

The current user specification uses local OCR for order amounts and SOM for barn
sale results and the existing SALE fallback.
Market refresh time also retains the previous local OCR path, following the
user's rollback request. The earlier red-shortage numeric deletion and
sale-quantity checks are superseded.

| Region | Decision |
| --- | --- |
| Each helicopter amount crop | Local `stock_pair` OCR reads owned/required at 2x scale and minimum confidence 0.90. Owned < required selects shortage-product images; owned >= required permits fulfillment. Unread quantities hold that order. No greater-than-seven deletion. |
| Free market refresh timer | Existing caption-bound OCR, H/M/S parser and 0.82 confidence check (user update, 2026-10-12). At least 30 minutes must still remain at return, between deletions and immediately before input. |
| Barn sale result | Observe the sale popup closing back to the barn. No capacity crop, numeric reading or before/after comparison (user update, 2026-10-12). |
| Default sale quantity | Leave the game default untouched; do not read or validate it. No denominator-equality or exact-quantity decrease check. |
| Existing SALE fallback crop | `Is the text SALE?` supplies the existing geometry-coverage check. |

The existing choice cache, registered regions, frame/hash bindings, stops,
input ownership and uncertain-result safeguards remain. A sale also requires
the selected popup to close; a click alone does not establish success.

## Dealer pickaxe purchase — 2026-10-11

At market entry, inspect the dealer's blue button at most once per visit with
`Is this a blue SEARCH button?` using the existing yes/no/uncertain SOM response.
Do not search again while dragging or returning from a dealer dialog. After a
completed dealer purchase tap, suppress entry searches for one hour, including
after restart; the next market entry after the deadline may search again.

Recognize `WHAT DO YOU NEED?` separately from the barn. Open the fourth mining
tab, select the registered pickaxe, press its green SEARCH, wait three seconds,
and buy the third (rightmost) pickaxe offer using its coin button. No price,
quantity or rest-timer OCR is required. Never use NEW SEARCH or SPEED UP.
The user explicitly removed ON BREAK/result confirmation for this purchase:
complete the action as `dispatched` after a confirmed native input receipt and
continue current-screen work. This is not a claimed inventory change. Uncertain
native input keeps the existing unresolved-input guard. Retain only the visit
flag and next-search timestamp; dealer purchases do not count toward the four
ordinary market purchases. Original crops, source hashes and fractional regions
are registered under `reference/som/dealer`.

## Return after four market purchases — 2026-10-11

Each shopping visit returns to helicopter delivery after four needed offers have
confirmed purchase results. One successfully purchased offer counts as one,
regardless of its bundle quantity. Planning, rejected input, repeated settlement
of the same offer and popup-interrupted attempts do not add successful purchases.
Existing matching, initial-slot exclusions and per-product attempt limits remain.

After the fourth confirmation, close the market using its current recognized
close target before any further product comparison, purchase or scroll. If the
target is missing, obtain a new observation without further shopping. Return
through town to the helicopter and recheck current orders before sending. The
existing market-return recheck policy remains applicable; four purchases do not
prove that an order can be delivered. The counter is disposable visit state and
resets when shopping ends or a new workflow starts. Existing earlier exits, such
as a completed needs list, market end or barn-full recovery, remain available.

## Market initial-slot exclusion — 2026-10-10

Market purchase eligibility no longer matches coin icons. Under the user's fixed layout rule, only the upper and lower slots in the original first column are excluded. All other structurally observed available cards can enter product comparison. SOLD takes precedence over the generic card border, and clipped cards, expansion controls, dealer and refresh controls remain non-purchase targets.

The market always opens at its beginning (user correction, 2026-10-11). Each new visit uses its first observed card grid as the origin and excludes the original upper and lower slots without requiring SALE or issuing an origin-search drag. The first column comes from the current card grid and is stored as a market-view fraction. An unreadable entry grid waits for current recognition without dragging. Android retains the measured four-column distance (675/734 of the market view, 400 ms) for the first forward movement and subsequent scrolling. Its displacement comparison includes the remaining overlap after a four-column movement; measured translation moves the original exclusion. Windows retains its 30% first-column movement and 57% ordinary baseline with gap correction. New leftmost coin cards are not excluded. An unchanged drag keeps the original exclusion. Translation is matched separately in the upper and lower product rows, so a temporary capacity badge obscuring one row does not discard an unambiguous match in the other. Conflicting row matches remain uncertain. Uncertain translation, an unreadable entry grid or changed geometry blocks purchases for one fresh observation; if still unresolved, close the market using its current recognized close target and continue the transport workflow without claiming market exhaustion. Repeated planning on the same frame does not consume the observation retry. Missing current close geometry continues observation without invented input. A new market entry or a currently recognized initial-slot marker can restore tracking without searching left. Android endpoint capture and the concurrent 0.2-second hold remain unchanged.

Position is temporary visit state, not a product/currency registry or a stock ledger. Purchase intents bind the position proof to the current frame/hash, viewport, profile, card and purchase target; existing owner, stop and result guards remain. Optional SALE evidence only establishes the beginning and does not independently exclude other cards. Saved-image and synthetic workflow tests are offline evidence, not live purchase acceptance.

## Mobile behavior restoration — 2026-10-10

Android preserves the shared SOM decisions. Helicopter crops contain the product and its ready check in one region; bound amount OCR distinguishes shortages from sufficient stock. A slot is empty only when its product and amount regions are both flat cream; an unread amount beside artwork stays unknown. Amount comparisons and the observed SEND lettering feed the existing `readyOrder` and deletion policies. Refreshing requires positive WAIT or SPEED UP evidence; missing SEND alone does not hide shortages or deletion evidence. UI matching uses the shared correlation thresholds without a mobile-only absolute pixel-error cutoff, including the barn registration. SOLD uses registered lettering, with no additional Android OCR route. The actual phone SALE marker feeds the existing special-card exclusion and market coverage.

The request-stage minigame detector again requires helicopter title, reward cash and PLAY lettering. Mobile layout and template scales are explicit; an entered mission's HUD does not substitute for those request markers. WAIT/SPEED UP and request cash/PLAY reuse unchanged pixels from original PC game captures at the mobile UI scale. Their phone layout wiring is tested with in-memory arrangements, but original mobile positives for those screens are not yet available. This is not live mobile recognition acceptance.

SOM Send requests the same two-tap send/skip action on both providers. ADB keeps one canonical action, dispatch marker and device fence across the pair, waits at least 100 ms between taps, then rechecks stop, ownership, source and device binding before the skip. ADB uses one batched target inspection between taps; transport latency still adds to the minimum interval. A receipt confirming both taps selects the existing 500 ms result floor; partial/uncertain dispatch retains the unresolved action and is never retried. Saved stops and device/boot/display binding remain. The shared native Restart path retires abandoned input after owner/remote-idle checks; ordinary Start never does. Dispatch markers are retained only for outstanding actions and retired after terminal canonical commits. Unsupported legacy phone layouts still require their own geometry registrations; the pre-migration SOM workflow was helicopter-only.

Fixed-candidate evidence, limitations, independent review and installation receipt are kept in [the restoration work directory](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-som-behavior-restore-20261010). No live purchase, delivery, skip or paid control is exercised by the offline validation.

## Current-order proof without a visible halo — 2026-10-10

Market-reset rechecks retain the unique selected-marker route and additionally accept an exact current product/quantity crop match after a completed selection observation. The current order hash must occur exactly once among the surveyed orders, and that order's location must match the observed selection target. This alternative requires current frame and image-hash binding and is repeated at deletion validation. Duplicate content, another target, changed content, absent or stale binding, multiple selected markers, a new map or ready order remain unsafe. Existing complete-market, no-match, timer, current trash and input/result safeguards are unchanged. This supersedes the halo-only abandonment described in the historical sections below; scheduled coordinates alone still establish no order identity.

The saved live recheck previously abandoned a uniquely matching order because its selection halo was missed. Independent checks reproduced that failure and the corrected continuation, with negative identity and input cases. Installed at 2026-10-10T00:48:36Z. See [fixed candidate and evidence](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-reset-order-proof-20261010/README.md).

## Current Action Timing and Refactoring — 2026-10-09

The refactoring preserves installed gameplay decisions. Module ownership and canonical roots are listed in the [implementation workflow](mumu-workflow.md#source-roots-and-som-boundaries--2026-10-09). The [single-line plan](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/som-refactoring-plan-20261009.json) records the fixed candidate, validation and activation state.

| Action | Earliest result capture |
| --- | --- |
| Helicopter/market entry | 300 ms |
| Ordinary order selection | 100 ms |
| Market scroll | Android starts capture at the held endpoint, releases after 200 ms, then uses that exact capture without an added delay. Windows retains 100 ms after input completion. |
| Completed Send plus authorized animation-skip sequence | 500 ms after completion |
| Other actions, including barn entry and sale | 1,000 ms |

`som/action-policy.mjs` owns these floors and the 15,000 ms unresolved-result timeout. They schedule observations and never prove success. Ordinary survey navigation settles as `observed`; destructive actions retain their action-specific `confirmed` proof. Market-reset navigation uses its stronger selected-marker evidence and abandons the special deletion plan when that evidence cannot be established. The older selection-halo sections below describe retained recognition and its historical validation, not a requirement to verify every ordinary navigation target.

Numeric OCR uses one shared lazy engine for order amounts and free market refresh time. Callers use the public `recognize_region` adapter with validated crop bounds; image product matching still uses D1. Barn entry no longer initializes unused building-match assets. The selected-marker halo search is retained because initial visible-order selection and market-reset proof still use it.

An unchanged temporary image manifest is not rewritten on every observation; missing images and invalid manifests are rebuilt. Native metadata retention now includes visits together with frame/action dependencies. On the pinned offline state copy, 8,179 visits became 100 and compact serialization decreased from 3,669,614 to 903,121 characters without changing stops or input proof. These are offline measurements, not a live latency or delivery-rate claim.

## Sequential helicopter survey — 2026-10-09

The user's latest navigation policy accepts a missed order in preference to
selection verification delays. A survey snapshots visible marker body centers
as game-viewport fractions and visits them from top to bottom, then left to
right. One initially visible selection may be read immediately. No selected
marker, changed order hash, same-order comparison, or product identity proof
is required after a navigation click. A subsequent helicopter observation
settles that attempt as `observed`, without claiming the intended order was
selected. An unchanged panel and missing map markers therefore do not reach
the old 15-second selection-failure hold.

Coordinates are disposable within the same panel visit, profile, window and
capture/viewport geometry. The route retains its original frame/hash, while
each input binds to the latest observation and converts fractions at dispatch.
Panel departure, geometry changes, delivery/deletion or a new shopping cycle
discard the route. This same-panel coordinate reuse is the user's explicit
exception to requiring every marker to be rediscovered before each click.
An uncertain native dispatch, unknown screen, saved stop, or foreign owner
still prevents further input.

Current readable orders supply needs; unread quantities, missing delete
controls and refreshing panels skip their route entries. Completed routes go
shopping if they collected needs. If all observed route entries are refreshing,
close the panel using its current recognized close target, then reopen it from
town for a fresh survey. A positive refresh panel with no active pins can also
return to town. The repeated town/helicopter navigation is intentional to keep
the phone active (user update, 2026-10-11). A completed market-return reset uses
the same immediate return when its current panel is refreshing. If a reset still
has unlocated orders but the current panel is positively refreshing with no
active pins, also return through town while retaining those pending locations;
their disappearance is never recorded as a completed deletion. Unread orders,
interrupted selections and new or ready pins do not prove that all orders are
refreshing. Other completed routes, or a missing close target, retain the
bounded idle and rebuild after 30 seconds.
No order identity is inferred from a scheduled coordinate. Skipped-order
diagnostics remain visible without making them a global input hold. Current
Send, delete and purchase checks are unchanged. The special market-exhaustion
deletion plan is abandoned if its stronger selection evidence is unavailable,
allowing ordinary surveying to continue.

Validation: focused navigation, input binding, unchanged results, missing
markers, geometry changes, popup interruptions, refresh, quantities, market
reset and existing shopping/delivery tests. Live gameplay is not part of these
offline checks.

## Reset unfulfillable orders after market exhaustion — 2026-10-09

The reset retains locations observed throughout its current survey, including refreshing pins, because selection artwork can temporarily hide a previously detected pin. A known pin reappearing does not establish a new order. Temporarily absent pending orders remain unchecked; navigation uses only currently recognized visible pending pins. The later best-effort rule below supersedes abandonment when none is available. Every deletion still requires current order identity and target evidence. The 2026-10-10 correction was independently validated against 33 saved originals and installed; the Monitor was already stopped before activation, so post-installation live deletion remains unverified. See [scoped validation](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/market-reset-occlusion-20261010/validation/independent-verdict.json).

The 2026-10-11 user update replaces the zero-purchase condition with a current delivery check after returning from the market. A verified market entry and observed free refresh timer establish this visit; purchase attempts, matches, uncertain product comparisons and reaching the market end no longer gate reset. Early return after buying all needed product types or barn recovery can therefore proceed to the same helicopter recheck.

The 2026-10-11 follow-up makes the reset a best-effort recheck followed by deletion. Recheck reachable order locations, including previously waiting pins, before deleting; missing pins and failed selections remain pending without cancelling the reset or blocking other orders. New visible pins join the same reset. A uniquely selected location binds its fresh order image because purchases can change owned counts. Later content changes still invalidate that order proof. Ready orders cancel reset and take priority; refreshing panels are skipped and SPEED UP is never used.

When map selection cannot identify the displayed order, its current nonempty order hash, visible shortage and trash button, plus the current frame/hash binding, permit deleting that displayed order. This does not claim an unseen location was checked or deleted. No map coordinate is guessed. Each attempted location is tried once per pass. Under the subsequent 2026-10-11 user update, when this pass has no usable current target, return to town using the current recognized close target instead of entering SOM_MARKET_RESET_REOBSERVE. This applies even if some waiting pins remain visible or the current panel is not refreshing. Preserve pending orders and the market timer proof; do not mark unseen orders complete. Only a confirmed panel exit clears the previous visit's selection, attempts, deferrals and retry deadline. Reenter the helicopter panel and recheck currently visible targets. Without recognized close geometry, retain the three-second observation retry without inventing coordinates. Existing popup, input, ready-order and timer guards remain. Restart discards the disposable plan.

At least 30 minutes must remain on the verified free market timer, inclusive, on return, between deletions and immediately before input. Unknown input/results, missing trash targets, changed geometry and positive delivery evidence retain their safeguards. The delete proof records that the recheck covers currently observable orders; it does not assert complete map coverage. Purchase counts remain diagnostic only. The former shortage-quantity deletion rule was removed on 2026-10-12.


Validation uses offline workflow and input fixtures for purchases, changed owned counts, early market return, ready orders, waiting orders, sequential deletion and timer boundaries. It does not establish live deletion acceptance.



Navigation settlement records `observed` rather than claiming that a marker
was selected. Market-reset planning separately requires one currently selected
marker whose tip is near a surveyed order, unchanged order content and the
current delete proof. Marker body boxes remain geometry evidence; the earlier
body-center/change-of-content fallback is historical and is not the current
navigation result contract. Missing or ambiguous selected evidence abandons the
special reset. A refresh countdown never authorizes SPEED UP or delivery.

When touching marker borders hide an upper selected tip, recognition searches the existing bilateral selection halo only inside accepted merged border components and only if no selected marker was already found. It searches across the merged component width and requires a compact, unique cluster with a 2-by-2 grid of matching anchors, rejecting isolated matches near clocks. Both existing halo bands must still pass; an actually hidden band or multiple supported clusters remains unresolved.

## Refreshing helicopter orders — 2026-10-09

The user's refresh-panel instruction forbids SPEED UP and requires selecting another visible eligible order. Static `ORDER ISN'T READY` or `SPEED UP` lettering identifies the waiting panel; it emits no Send or trash target and no shortage crops. Normal Send additionally requires actual SEND lettering, so green color alone cannot authorize delivery. Selected waiting pins are skipped during the current survey. Under the 2026-10-11 update, an all-refreshing survey returns to town and reenters the helicopter panel without the former idle interval, intentionally keeping the phone active. Existing needs can proceed to the market after other eligible pins are exhausted. Missing close geometry or unread orders retain their existing observation behavior. Input uses current observed geometry and the existing percentage contract.

Installed evidence and focused validation: [refresh skip report](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/helicopter-refresh-skip-20261009/README.md). Saved-image and planning checks passed; actual live skipping remains unverified while the Monitor is paused.

Helicopter minigame requests interrupt normal decisions before Send/popup
handling. Recognition requires the helicopter title, Town Cash reward icon
and Play lettering from actual game evidence; preview art and reward amount
are excluded. While `minigame_requesting`, normal work waits until the
Monitor's `미니게임 해결` button completes its one-second delay. Every three
minutes from the request, a fresh observation may tap the currently recognized
HELICOPTER PAD title once, only on the helicopter panel without a popup or
motion. Other screens and missing title targets skip that interval. The tap
uses the existing guarded percentage input and result observation; it does not
resolve the handoff or click Play. Uncertain input/results block further taps.
The interval and handoff are in memory only. Timing records
append permanently across restarts; the pause itself is only in memory.
See [Monitor handoff and timing log](apps/TownshipMonitor/README.md#minigame-handoff).

The 2026-10-09 user direction replaces quantity planning for this mode. A wrong
ordinary coin purchase is an accepted recognition loss. D1's `same_product`
winning choice is sufficient; there is no extra probability or margin cutoff.

`tools/som/` is the new workflow. `settings.workflowMode = "legacy"` selects the
previous `MonitorDelivery`, product-template/catalogue, OCR, allocation and
registration workflow. Those modules remain for compatibility and other
transports. SOM reuses the existing barn UI evidence and lazily initializes
numeric OCR for order amounts and free market refresh time.
Market product matching remains image-based.

The SOM loop opens visible red helicopter pins, stores crops only for slots
whose displayed owned count is red, and visits the market after the survey.
It makes at most one purchase attempt per matching product per market visit,
irrespective of bundle size. Two slots showing the same product do not create
two purchases, even when their crop pixels differ. Before comparing market
offers, SOM groups matching need images once for the current survey. Uncertain
aliases remain separate; a grouped alternate crop can resolve an uncertain
primary comparison. Attempted products leave ordinary offer search. A prospective
new purchase is checked against purchased artwork to suppress an unmerged alias.
Other needed products each get their own attempt.
SOLD, plus slots, dealer and paid refresh controls are not purchase
targets. When all distinct products have had their visit attempt, it returns
immediately without another offer comparison or scroll. Otherwise it scans toward the right end from the initial position. A dispatched attempt interrupted by a popup still consumes
the existing visit limit; this does not claim the product was purchased.
Whenever the displayed order has no shortage marks and its Send button is
active, it sends directly, including the next order automatically selected by
the game. A selected green map pin is no longer a prerequisite. Only a displayed
shortage triggers order selection/survey; a temporarily inactive Send with no
shortage waits for another observation. The decision observation checks the same order content and active Send. A changed order or removed green pin after
input confirms progress; an unchanged screen does not confirm delivery.
Leaving shopping discards that visit's image
needs and purchase limits. After delivery, a new survey builds a new list from
current orders. It does not check whether any old shortage is "still" present.
The same product can be purchased once again in the next market visit when it
appears in that newly built list.
Train and airplane work remain in legacy mode.

## Order amount OCR rollback — 2026-10-12

The user restored OCR for helicopter quantity reading after SOM color and
numeric-comparison prompts failed saved-image checks. Read each occupied
registered amount crop with the existing `stock_pair` parser at 2x scale and
minimum confidence 0.90. On a failed raw reading, retry once using brown/red
number strokes from the same crop to exclude green check edges, retaining
the original crop/hash and the same confidence threshold. Bind its owned/required result to the current amount,
product and order hashes. Owned < required adds that product image to the
current shopping needs; owned >= required adds nothing. At least one valid
numeric slot, all other slots read or positively empty, no shortage and the
current recognized SEND target are required for delivery. Both product and
amount regions must be flat cream to mark a slot empty; OCR failure alone is
never empty. Unread or changed evidence holds only the affected order.

This restores quantity reading/comparison only. The removed numeric order
limit/deletion policy remains removed, and shopping remains image based.
SOM still handles product matching and SALE. Barn-capacity comparison was removed by the user on 2026-10-12. The
free market timer keeps its existing OCR/parser/0.82-confidence behavior.

## Specific-product prompt — 2026-10-13

Product comparison now asks whether the crops show the same specific product,
not merely the same general category. Different variants count as different
products. It compares artwork while ignoring quantity numbers, check marks,
labels, overlays, background and scale; uncertainty retains the existing
`uncertain` choice. The three-choice request contract is unchanged. Concurrent
client changes excluding uncertain product answers from the cache are preserved.

On 60 reviewed saved-game pairs, two repeats gave identical results: wrong
matches decreased from 4/40 to 3/40, correct same-product matches increased from
18/20 to 19/20, and total correct decisions increased from 54/60 to 56/60.
The initial longer wording was rejected for new false negatives. The accepted
wording fixes one cheese distinction and one same-loaf match; three false
matches and one missed match remain. The cases were reused during refinement,
so this is scoped offline improvement rather than held-out or live-play proof.
See [the fixed prompts, cases and independent validation](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/som-product-prompt-20261013/REPORT.md).

A subsequent shape/color question and choice-description trial distinguished the
retained soft-serve/scoop and white/pink textile negatives, but left the
croissant/loaf mismatch and introduced six new false negatives. Exact decisions
fell from 56/60 to 53/60; additional unscreened pairs fell from 26/27 to 22/27.
The candidate was rejected and this installed prompt retained. See [the similar-product investigation](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/som-variant-prompt-20261013/REPORT.md).

## Product prompt comparison — 2026-10-09

The product request now starts with `Compare the products shown in these two
cropped images.` The reference/candidate roles, identity-only instruction,
ignored overlays/background/scale, question, three choices and winning-choice
policy are unchanged. Popup button prompts are unchanged.

A local D1 A/B run used 247 labeled saved-image cases (221 distinct PNG-hash
pairs), twice per prompt with alternating arm order and cleared client caches.
Each repeat found 18/19 positive products with either prompt. Wrong matches
between different products decreased from 3/190 to 2/190; non-product control
matches decreased from 4/38 to 0/38. Product-only exact accuracy was 205/209
versus 206/209. The 77x66 wider order positives remained 8/8. Median warm-server
latency was 102.9 ms versus 104.0 ms; this does not establish a speed gain.
Both repeats gave identical choices and no request errors; 14 existing workflow
tests passed. Saved crops share sources and are not an independent random sample.

The narrow 40x57 paper stress crop changed from `uncertain` to
`different_product`, so that crop would no longer trigger the existing alternate
crop fallback. Current SOM order extraction uses 77x66 crops at the registered
geometry; the tested full and wider paper crops matched with both prompts.
This remains a partial-crop limitation, not a general recognition guarantee.
SOLD/plus controls are excluded before ordinary market matching; their test
results do not establish an additional live purchasing improvement.

Evidence: [A/B summary](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/som-prompt-comparison-20261009/evidence/summary.json)
and [fixed requests](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/som-prompt-comparison-20261009/evidence/prompts.json).
## Single observation before input — 2026-10-09

The user removed the second capture and semantic analysis immediately before
input. SOM now plans from one captured observation, dispatches directly from
that frame, then captures the result. A confirmed result observation also
supplies the next decision. No `device.capture`, `worker.analyze`, preflight PNG
or preflight timestamps are produced by `issueSomInput`.

`somProof.inputMode = "source_observation"` binds the action to its original
frame/hash, current source pointer and epoch. The adapter and native helper
validate that binding and current window geometry, percentages, stops and
input ownership. They do not reread game content before the click. The source
observation keeps its actual capture time; model comparison time does not
require a new image. Native dispatch must start within five seconds of input
reservation. Legacy actions retain their capture-based preflight contract.

## Fixed barn entry — 2026-10-09

After recognizing the current town at the registered capture size and game
viewport, SOM uses `town.barnTap` in `reference/som/profile.json`:
x = 0.56, y = 0.24 of the game viewport. The point lies on the barn facade
in saved frame `frame-145b4f0b-daf4-44b6-87e3-7f7d4690d4b0`; the profile
retains its hash. Barn building artwork is not matched to locate entry.
The same percentage validation used for market entry rejects missing or
invalid fractions and mismatched geometry. Current frame/hash and native
window guards remain. Only a recognized barn result confirms entry; an
uncertain result remains unresolved without another entry tap.

## Fixed market entry — 2026-10-09

The user keeps the town building layout fixed. Once the current frame is
recognized as town at the registered capture size and game viewport, SOM uses
`town.marketTap` in `reference/som/profile.json`: x = 0.21, y = 0.45 relative to
the game viewport. Market building artwork is not matched before this tap.
The profile records the source frame/hash; its dimensions and viewport scope
the configured fractions. Pixels are derived only while analyzing a matching
current frame. Missing/invalid fractions or changed geometry cannot produce
a market target. The decision observation must recognize town, and the result must
be a recognized market screen before shopping starts. An unconfirmed result
retains the existing unresolved-input hold, without another entry tap.

## Android fixed town entry — 2026-10-10

The same fixed-layout policy applies to Android. At the registered 1544×720 full game viewport, `reference/som/android-1544/profile.json` supplies market (0.28, 0.56) and barn (0.52, 0.30) entry fractions. The market point was corrected on 2026-10-12 after the former (0.34, 0.49) point missed the canopy on shifted town views; see `artifacts/monitor-market-entry-20261012` for the fixed candidate and evidence. The source game capture, hash, device and frame identity are retained in each registration. After matching the town anchor, the Android recognizer reuses `Vision.town_target`; it must not require market or barn building artwork matches. Helicopter icon recognition is unchanged. Missing town recognition, invalid fractions or changed viewport/capture geometry cannot produce a fixed entry target. Input ownership, device/frame/epoch guards and result confirmation remain unchanged. The Android migration initially omitted this standing policy; it was restored after the user reiterated the market rule. [Candidate and independent evidence](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/android-town-entry-20261010/README.md).

Product comparison receives only the helicopter and market product crops.
UI geometry still uses actual-game title/button/currency anchors and colour
contours; SOM is a classifier, not a coordinate generator. Normal frames need
no SOM scene classification. Identical crop comparisons are cached. Product matching does not read bundle
quantities; numeric OCR is limited to the current scopes listed above.
Active observation is scheduled after 400 ms. First-result timing
for a pending action overrides that ordinary schedule. Opening helicopter or
market buildings uses 300 ms; selecting an order uses 100 ms. Other actions
retain 1,000 ms unless explicitly described below. An exhausted empty survey waits 30 seconds before rebuilding its route, except for the all-refreshing town-return loop described above.

Market comparison memory also reuses stable artwork across scroll rounding of
up to two pixels. Reuse requires the same profile, viewport, market view and
crop dimensions, with strict pixel-error checks. An uncertain correspondence
is compared again. This bounded memory is discarded on leaving the market,
changing geometry/profile, rebuilding needs or restarting. It stores no click
coordinates or stock ledger. Saved replay covered 27 market frames: 7 additional
offer reuses beyond exact hashes; 110 reviewed different-product pairs were
rejected. These offline counts do not establish a live speedup. SOM batching
remains disabled because the saved exploratory benchmark lost accuracy and speed.

## User-observed early actions — 2026-10-09

The user's rough timing observations define when to start observing, not proof
of completion. Each result still needs its current bound visual transition.
Helicopter Send uses one specifically authorized compound action: the initial
tap and exactly one animation-skip tap at the same percentage-bound location
100 ms later. The native helper checks stops, ownership, pointer and window
geometry before that second tap; a late or interrupted sequence is not retried.
The receipt records completed/planned clicks. After a complete two-tap receipt,
the first result capture waits 500 ms from dispatch completion. Recognition and
capture add their own time; this is not a guarantee of 600 ms end-to-end latency.

The existing legacy barn-sale path starts result observation after 100 ms and
closes the currently verified X immediately after proving the sale and
capacity decrease, allowing remaining animation to be skipped. An unreadable
result remains unresolved. SOM has the separately authorized one-sale-per-allowed-tab barn recovery route described below.

For an unexpected opaque panel, geometry locates button candidates inside the
current viewport. D1 checks whether the button says CLAIM; otherwise it checks
the current X candidate. A click is followed by a new observation before
continuing the interrupted workflow. Popup click coordinates come from the
current detected button. The attached Daily Bonus original is an offline positive case.
Transparent, unusual, or unreadable panels may still need another UI locator.

Each input retains exclusive capture ownership, saved stops, all unresolved
action checks, current frame/hash/viewport binding, normalized game coordinates,
native window/occlusion checks and a dispatch receipt. Changed source bindings
reject before input. Unconfirmed input results remain unresolved after
15 seconds; the action is not retried. Popups can interrupt an action without
claiming a purchase or delivery succeeded. A failed offer is skipped for the
current visit, including other matched slots of that product. An input rejected
before dispatch does not consume the visit's attempt. Barn-full recovery follows the one-sale-per-allowed-tab rule below.

Temporary product images and their capture/hash/percentage provenance live in
`runtime/mumu-autonomous-transport/.monitor/som-needs/current.json` and sibling
PNG files. They are rebuilt after restart and removed as the working list
changes. This is neither a product registry nor a stock/completed-order ledger.

The Monitor first checks `/health` and the `d1-3b` model at its configured
localhost endpoint. A healthy service is reused without reading or executing
`%LOCALAPPDATA%/TownshipAI/d1-3b/Start-D1.ps1`, so an inaccessible launcher file
cannot reject an already running service. Only an unavailable service invokes
that script, once, with the configured port. Readiness is checked again after
the attempt, including a failed attempt if another process started the service.
Wrong-model services are rejected; script success alone is insufficient.
Closing the worker cancels pending checks/startup. Model startup does not clear stops.
The `set_workflow_mode` Monitor bridge operation accepts `som` or `legacy` only
while paused, owner-free and input-settled. Selecting a mode never starts play.

Validation distinguishes real screenshot perception, model comparisons, pure
state-machine tests and mocked native input tests. Offline success does not
establish a completed live purchase/delivery cycle.

The Monitor displays only the required-goods image panel and basic run controls.
SOM images come from the temporary list above, with a session/incarnation binding
that prevents display of a previous run's list. No quantity is shown in SOM mode.
The UI requests a compact read-only snapshot, bypassing preview decoding and
diagnostic projections; current frame/input evidence remains internal to the
executor. The legacy transport display can still consume its existing required
goods projection. No logs, full-screen preview or diagnostic tabs are rendered.

## Market scan improvements — 2026-10-09

The existing market drag remains 67% of the recognized market view over 400 ms.
After it settles, alignment uses only the distance from the fixed inner wooden
boundary to the dark vertical gaps between wooden price plates. Both rows must
support at least three regularly spaced gaps. Measurements use fractions of the
current market view. No product artwork matching, model call, additional image
decode, or separate measurement capture is introduced. Per the user's explicit
instruction, this does not count or verify how many whole columns passed.

The first view establishes a temporary gap anchor. After each ordinary scroll,
the result stores only the signed gap error. The workflow inspects and purchases
visible needed offers as usual. When the next ordinary scroll is needed, its
normalized distance remains `0.67` when the absolute error is five pixels or
less. Larger measured errors use `0.67 + current signed gap error`: undershoot
lengthens it, overshoot shortens it. It always scans right and retains the 400 ms
duration. There is no separate correction action, reverse drag, or correction
retry loop.
Repeated observations recompute against the same anchor; they never add the same
error twice. New results replace the residual rather than accumulating a sum.

Changed profile, viewport or market-view scope still holds the scan. Unreadable
gaps or an unreliable pitch instead discard the temporary correction anchor and
continue the ordinary 67% / 400 ms drag. Gap measurements are optional correction
evidence, never a prerequisite for a baseline drag. Existing source-frame and
percentage-coordinate validation still applies. Each issued ordinary scroll
increments the page count once. End markers and the existing no-motion end check
retain visible-offer handling before exit. Finishing purchases never issues a
scroll only for alignment. Restart, market entry and popups discard the temporary
alignment state. The existing current-frame percentage input guards remain.

After a scroll, the first result capture may start at 400 ms. A lightweight
market-region descriptor is compared between two distinct result observations
at least 100 ms apart, within the same action, epoch, profile and viewport.
While it changes, the program requests another observation after 100 ms and
does not extract product crops, call D1, buy or issue another scroll. A stable
observation receives full analysis using the same captured bytes, then normal
result verification and planning continue. A popup interrupts the action under
the existing contract; a result still unconfirmed after 15 seconds remains
unresolved. The extra stability observation has a capture cost, so a shorter
initial delay alone is not evidence of an end-to-end speedup.

As of the user's 2026-10-10 update, the all-SOLD exit check considers only
fully visible product cards in both market rows. Partially clipped edge cards
are ignored; their SOLD lettering is not required. Observed slot spacing still
detects missing fully visible cards, and a recognized plus slot is not a product.
Empty detections, unreadable card states, missing fully visible cards,
a moving view or an unavailable close control cannot trigger this exit.
The check runs before need grouping and product comparison. The market-exhaustion
reset described above retains its separate complete-search requirement and can
continue scrolling an all-SOLD view until the market end is established. This
relaxation does not supply missing whole-market evidence for deleting orders.
Returning to delivery discards temporary needs and purchase-attempt limits;
the next survey reads current orders again.

The installed single-observation input path already eliminates the second
pre-input capture and semantic analysis, including for scrolling. This release
preserves it and its window, stop, ownership and percentage guards. Existing
product caches and duplicate-purchase handling are unchanged; no additional
product identity comparison or cache expansion is introduced.


## Full barn recovery - 2026-10-09

Either `BARN IS FULL!` or `UPGRADE NOW` from the supplied actual-game capture
identifies the capacity warning. The lettering is matched within a panel found
in the current viewport before the dimmed market background is classified.
A separately matched current X closes it; no upgrade button is pressed.

The warning ends that shopping visit immediately and discards its temporary
needs and attempts. Close the market, enter the barn using the configured game fraction after town recognition,
and use only the sprout (`crops`) or bread (`products`) tab. The user's explicit
selection replaces quantity-based reserve protection for this SOM recovery:
On October 10, the user changed recovery to visit both allowed tabs. In each
tab, inspect the first visible occupied slot in display order and sell exactly
once with its untouched default quantity. Verify each sale before switching
to the remaining tab and inspect its current slot. ALL, construction
and mining tabs cannot authorize a sale. Skip a confirmed empty allowed tab;
missing tab or row evidence holds recovery. Completed tabs are tracked only
within this recovery and are never sold twice during the same visit.

Existing screenshot UI evidence recognizes the barn panel, tabs and sale controls. This
path does not register guessed product names. A confirmed inspection connects
the popup pointer to its slot; an existing unproven selection cannot be sold.
The 2026-10-12 user update removes capacity-decrease verification. After the
issued sale, the popup closing back to the recognized barn without another
modal confirms completion. Neither capacity nor default quantity is read.
Current frame/hash/epoch, dispatch receipt and ownership bindings remain.
An uncertain dispatched sale stays unresolved and cannot be retried.

After both allowed tabs have a confirmed sale or are observed empty, close
the barn and go directly to helicopter delivery.
Do not reopen or resume the interrupted market visit. A later normal survey
may create a new shopping visit from current orders. Missing UI or
allowed-tab evidence holds recovery without an upgrade or speculative sale.
Offline screenshot and state-machine validation is distinct from live gameplay.


## Partial selection halo recovery - 2026-10-09

Installed at 10:57 UTC after an actual repeated order-selection hold. Merged
marker recovery first uses the existing strict bilateral halo search. Only
when it finds no candidate does it try partial bilateral support (40 pixels,
18 rows, at most 32 pixels of cluster spread); colour, run, distribution,
2x2 support and unique-cluster requirements remain. Normal marker detection,
percentage input bindings and result/shortage transitions are unchanged.
Fully hidden halos and ambiguous or insufficient evidence remain unrecognized. The current sequential survey above does not require a halo after ordinary navigation; special reset proof remains stricter.

Independent validation passed 55 image/cluster checks, 12 UI tests, 38 workflow
tests and 20 actual-action checks. The new current failure is covered; the
older insufficient 10:43 result intentionally remains unconfirmed. Installation
preserved the paused, input-settled boundary and retained the previous source.
Live resumption is verified separately from these offline results.

Evidence: [fixed candidate and independent verdict](C:/Users/djfal/OneDrive/문서/ChatGPT/Township/helicopter-partial-halo-recovery-20261009/evidence/independent-verdict.json).
