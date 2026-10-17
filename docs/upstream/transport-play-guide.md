---
language: en-US
---

## Requested quantity limit restored — 2026-10-13

The user's latest correction restores Android SOM deletion when any current
helicopter product slot requests at least eight units, regardless of owned stock.
Apply this before ready delivery, failed-product review and shopping. Seven is
eligible. Exclude the entire affected order from shopping, including when deletion
is deferred. Use current hash-bound readable OCR and current trash geometry; the
common fifteen-minute timer and all existing input/result guards still apply.
Unknown timer uses the existing timer-only market visit. This supersedes historical
statements below that removed the numeric limit. Windows SOM is unchanged.


Follow the approved Android [operating recovery](som-workflow.md#operating-recovery)
for bounded completed-input uncertainty, market/order/barn exits and recognition
failures. Current ready work takes priority. Retired uncertainty does not prove
delivery, inventory change or market absence. Minigame handoff remains unchanged.

The user's 2026-10-13 [completed Send correction](som-workflow.md#unconfirmed-completed-send--2026-10-13)
allows current-screen work to continue after the bounded result wait when both
send/skip taps have finished. The previous delivery stays unconfirmed; do not
count it or replay it. Incomplete input and unidentified current screens remain
exceptions. This scoped rule supersedes the blanket unresolved-result hold for
completed SOM Send only.

# Township Market-Based Delivery Guide

## ADB deletion policy — 2026-10-13

The user approved [ADB order deletion and the common market session](adb-order-deletion.md).
For Android SOM it replaces the older no-deliverable-orders reset and 30-minute
threshold below: deliver ready orders first, delete short orders requesting a
failed product, and delete a still-unread current order after one fresh retry.
Two distinct confirmed purchase-return shortages or a complete verified no-match
search fail the requested product for this market refresh period. All deletion
reasons require at least 15 minutes on the common verified timer. Failed crops
are review evidence; refresh invalidates active decision state. The 2026-10-14 update permits
market-session checkpoint reuse within three minutes of its last successful save;
see the canonical ADB deletion policy for invalid-file and expiry behavior.
The user's followup removes the sufficient-artwork/stock-consumption exemption:
only current matching shortages evaluate purchases, with the first failure deferred
and the second registered (user update, 2026-10-14). Ready orders still send without SOM comparison.
Windows SOM and legacy quantity rules retain their existing scope. Installation
and validation status are recorded in the capability index.

## Bounded Return Rechecks — 2026-10-13

Market-return order rechecks are best effort and limited to two passes. Skip unusable selection targets and then resume ordinary current-screen work without marking skipped orders complete. See [bounded return rechecks](som-workflow.md#bounded-return-rechecks--2026-10-13) for attempt accounting, confirmed-exit and input safeguards. This limit supersedes unlimited reentry retries described below.

## SOM Policy Update — 2026-10-09

The market-return deletion paragraph below is historical for Android SOM; the
2026-10-13 ADB policy above takes precedence.

After returning from the market, recheck current helicopter orders. If none can be delivered and the verified free market refresh timer still has at least 30 minutes remaining, delete all existing deletable orders with their trash buttons (user update, 2026-10-11). Purchases, product matches and whether the market scan reached its end do not decide this reset. Bind updated owned-count images to the current order locations during the return recheck. Ready orders take priority; verify each deletion and skip refreshing orders. The 2026-10-11 follow-up makes order-location rechecks best effort: missing pins or failed selections defer only those locations, retain the reset and allow currently observable orders to be deleted. A readable current order with a current trash target and source-frame binding can be deleted without identifying its map pin. When no current target is usable and the reset would enter SOM_MARKET_RESET_REOBSERVE, return through town and reenter the helicopter panel using currently recognized navigation targets (subsequent user update, 2026-10-11). Keep unconfirmed orders pending, and reset visit-local selection attempts only after a confirmed exit. If the close target is missing, reobserve after three seconds; never infer coordinates or mark unseen orders complete. Unread timers, changed geometry, ready orders and unresolved input retain their safeguards. See [market exhaustion reset](som-workflow.md#reset-unfulfillable-orders-after-market-exhaustion--2026-10-09).


Refreshing helicopter orders showing `ORDER ISN'T READY, WAIT OR SPEED IT UP!` must be skipped for another currently visible eligible order. Never click SPEED UP or treat its green color as Send. When all observed orders are refreshing, return to town using the current recognized close target and reenter the helicopter panel through normal navigation. This town/helicopter loop is intentional to keep the phone active (user update, 2026-10-11); do not idle in the order panel until its timer expires. Unread orders are not refresh evidence, and a missing close target still prevents invented input. See [refresh recognition and navigation](som-workflow.md#refreshing-helicopter-orders--2026-10-09).

The user's follow-up limits each product to one purchase attempt per market visit, not one purchase across all products. On returning to helicopter delivery, discard the shopping list and visit limits. The next order survey creates a fresh list from current screens; do not compare it with previous shortages. See [SOM workflow](som-workflow.md) for the image-based product grouping and visit boundary.

The user's quantity-free helicopter direction applies when `settings.workflowMode` is `som`: collect missing product images from red orders, buy matching ordinary coin bundles without counting units, then deliver currently green orders. Product naming/registration, shared-stock allocation and routine capacity scans are legacy-mode requirements and do not gate this loop. The latest 2026-10-12 update restores local OCR of owned/required amounts after SOM color and numeric questions failed validation. Delivery requires owned >= required for all occupied slots; unread amounts hold only that order. The greater-than-seven deletion rule remains removed. The user's 2026-10-12 follow-up removes barn capacity-decrease verification entirely. A sale proceeds after its popup closes back to the recognized barn without another modal; neither capacity nor the default-sale quantity is read. The free market refresh timer retains the existing local OCR and elapsed-time checks after the user requested its rollback. SALE uses the existing crop with a SOM text question; uncertain answers do not authorize the affected decision. The user accepts occasional wrong-product purchases. SOLD/empty/dealer/paid controls remain excluded; current coordinates, ownership, stops and result checks still apply. The user removed SOM's second pre-input capture/analysis; actions use the decision observation directly. Unexpected visible CLAIM or X controls may be handled and the interrupted loop resumed. Exception: `BARN IS FULL!` or `UPGRADE NOW` ends shopping, performs one default-quantity sale in each of the sprout and bread tabs in visible order (updated 2026-10-10; skip confirmed empty tabs), and proceeds directly to helicopter delivery without resuming that market visit. The user explicitly selected this SOM rule on 2026-10-09; quantity-based surplus protection below remains legacy policy. See [SOM workflow](som-workflow.md) for implementation and limitations. Selecting or installing this mode does not resume gameplay.

## Percentage Coordinates

Follow the [percentage coordinate contract](coordinate-contract.md). Missing or mismatched frame/viewport bindings and out-of-viewport targets hold input; never fall back to pixel-only execution.

Updated 2026-10-07. Follow the user's current authorization. This guide is the canonical gameplay policy, including the current barn sale tab restriction below; it grants no new game input, purchase, dispatch, deletion, launch, or resume permission.

## Program and Manager Responsibilities

Follow the [program and manager policy](AGENTS.md#program-and-manager). Supported normal recognition, order navigation, shortage calculation, necessary purchases, delivery and result verification run through the program; AI handles exceptions, improvements and work that needs its assistance. Identify each order by its requested products and required quantities; customer identity is unnecessary.

Manager intervention includes unfamiliar products, recognition errors, unsupported layouts, allocation conflicts, and uncertain results. Turn confirmed exception evidence into reusable templates and checks so the program can handle the same work independently next time.

Use information exposed by useful work. The user-requested helicopter evidence pass below is the scoped survey exception; do not add unrelated surveys or repeated AI interpretation as routine prerequisites. An unknown product holds its order; independent known product observations can still inform current shortage calculations, and other supported work can continue when no input is unresolved.

## Current Orders and Needed Goods

Use the same loop for train, airplane and helicopter: inspect current orders, calculate needed goods, buy necessary available goods at the market, recheck the order, and fulfill it. Finish already feasible work before a market visit that serves no remaining shortage.

- Read identified products, required quantities and displayed owned counts from current order screens. The left number is owned; the right is required. Read rewards separately. Unknown is not zero.
- Keep these observations and the needed-goods list as temporary working data. Aggregate eligible demand and deduct shared owned quantities once, respecting plane > train > helicopter priority. Do not assign the same goods twice.
- Do not maintain a persistent stock ledger, completed-order history or inventory transaction archive for delivery decisions. After restart or a relevant change, inspect current orders and rebuild the working list; no old order or completed mission needs reconstruction or accounting first.
- After a purchase, load, delivery or other relevant change, recheck the affected current order and refresh its shortage. Do not infer current stock by replaying historical receipts or subtracting requested quantities from an old balance.
- Read capacity when the current purchase or space decision needs it. Per the user's 2026-10-08 instruction, do not check coin balance before buying. Do not scan the barn to initialize stock or verify an ordinary delivery.
- Verify reward collection as an action result. Undisclosed reward quantities require no stock reconciliation, complete product coverage or reward-total audit; read the needed products on current order screens. Never invent reward quantities.
- Preserve unresolved-input evidence, saved stops, authorization and exclusive ownership separately from temporary order data. These are execution safeguards, not a requirement to keep completed-order or stock histories.

Read enough current order information to apply the 8-unit rule to the whole order, including repeated products; checking one remaining slot is insufficient. If the current screen cannot establish that policy decision, hold only that order. The absence of an old order file alone is not a reason to hold it.

This policy supersedes the older ledger and historical-accounting requirements. Installed code may still depend on those mechanisms; use the validated change workflow to remove that dependency. Do not delete runtime files or bypass a program hold to simulate the new behavior.

## Complete Feasible Deliveries First

Finish verified feasible work on the current transport before inspecting future airplane products, surveying unrelated orders, or visiting the market/barn. Then handle other known ready transports. Use plane > train > helicopter among ready transports before opening one, and for ordinary planning after ready work is exhausted. Preserve higher-priority reservations and resolve concrete allocation conflicts immediately.

The user's 2026-10-07 request adds a native helicopter exception: inspect every currently recognized supported order location once for screenshot evidence before opening unknown-product information dialogs or beginning new delivery/market actions. Settle any already issued action first. Hold unidentified orders and continue the remaining supported locations; do not wait for AI registration. After this first pass, use normal feasible-work and shortage rules. Unknown input, unverified screens, saved stops and missing current coordinate bindings still block additional clicks. This exception does not change train or airplane sequencing. See the [evidence workflow](mumu-workflow.md#helicopter-order-evidence-survey).

Checkmarks discover candidates; verify actual orders, displayed owned quantities and current shared-goods commitments before input. Airplane readiness appears only on the tile map. References: [airplane callout](reference/tilemap-airplane-checkmark.png), [helicopter callout](reference/tilemap-helicopter-checkmark.png), [town helicopter badge](reference/town-helicopter-checkmark.png), [unmarked town buttons](reference/town-transport-icons.png). Saved references do not prove current readiness or full dispatch readiness.

A helicopter round processes supported feasible deliveries and policy deletions, then ends when no further supported work remains with currently confirmed available goods, after checking remaining visible order locations. Input count, order count and elapsed round time do not end a round. Individual transport action recipes retain their own limits and original deadlines. Confirm action results; a completed round does not end an authorized continuing management task. Continue other supported ready work while authorization is unchanged and no stop, unresolved input or actual blocker remains. An unchanged shortage or hold does not justify repeated scans.

## Current User Rules

- Use existing finished goods, necessary coin market purchases, or supported team product requests. Retain ordinary shortages and wait for free refresh, request availability, or response when needed.
- Do not supply shortages through factory production, planting, animal farming, island shipping, mining, or smelting. Ingredients cannot replace requested finished products.
- T-cash and all coupons are forbidden. Dealer operations remain disabled under the initial 24-hour charter; resuming does not restart that period. Unsupported team requests or deletion require implementation before use.
- If any requested product totals at least 8 units in an order, delete the deletable order with its trash button, regardless of product type or available stock. Do not deliver, buy, request or reserve goods for that order. Unsupported deletion on another transport holds that order rather than supplying it. Unread quantities cannot authorize delivery.
- Spend coins only on needed transport goods. Confirm product, bundle, price, COIN, and required space; no coin-balance precheck is required. Verify the actual purchase result and hold a confirmed insufficient-coins result without retrying. Do not add speculative purchases or arbitrary balance floors.
- Protect construction materials, minerals, ingots and unknown goods. Sales are allowed only in the sprout and bread tabs, after actual space need and surplus after transport reserves are confirmed. ALL and every other tab are forbidden for sales.

## SOM Barn Recovery Update — 2026-10-10

For the installed SOM workflow, each full-barn recovery sells once in each of
the sprout (`crops`) and bread (`products`) categories. Each sale uses the first
visible occupied slot and its untouched default quantity, and must be confirmed
by observing the sale popup close back to the barn, without checking capacity,
before proceeding to the other category. Skip a confirmed empty category. After
both categories are handled, return to helicopter delivery. No category is sold
twice in the same recovery. Missing or uncertain evidence retains the existing
hold. See [SOM workflow](som-workflow.md#full-barn-recovery---2026-10-09).

## Barn Recovery Policy

The user's 2026-10-08 instruction restricts sales to the two supplied sprout and bread tabs. It supersedes the historical every-third-shortage construction exception. ALL may be read or used to navigate to an allowed tab, but cannot authorize item inspection for sale or a sale. Construction sales remain prohibited for every episode.

1. Enter recovery only after a current, confirmed space shortage. Finish feasible deliveries first. Do not manufacture a shortage for testing.
2. Verify the active sprout or bread tab in the current full game capture. Follow the visible order from the upper left and skip unidentified, protected or reserved products.
3. Open an eligible product once and read its displayed default sale quantity. Do not calculate half, change the quantity, press the magnifier or upgrade the barn. Sell only if that entire displayed quantity is surplus after current transport demand.
4. Start result observation after 100 ms, based on the user's 2026-10-09 observation that sale inventory changes precede its animation. Confirm the same product's owned-count decrease and the barn used-capacity decrease against the issued quantity. Items may move after a sale. A missing, ambiguous or partial result retains the pending input and prevents retries. After proof, the currently verified X may be closed immediately to skip remaining animation, through the normal percentage/preflight path.
5. Return through the registered town view, reread current order stock and current market offers/capacity, and reassess the original shortage. Do not apply a historical inventory delta to make another sale or purchase.

The active shortage episode and pending sale are policy state, separate from disposable stock/order observations. Repeated frames, navigation and restarts do not create a new episode. Existing unresolved inputs and stops remain authoritative.

The screenshot registration currently identifies Donut, its default-quantity popup, and the two active-tab symbols. Original screenshots remain intact with hashes and crop bindings; variable screenshot origins are measured from the barn panel. Other goods, scrolling and unregistered layouts hold. The supplied sale sequence was photographed in ALL and verifies product/count/result recognition only; it does not authorize sales in ALL or demonstrate a live allowed-tab sale. Automated integration uses explicitly synthetic tab compositions. See [current capability status](remaining-implementation.md#helicopter-operating-improvements-2026-10-08-installed).

## Mayor's Cup Behavior

On 2026-10-05, the user authorized recognizing the `MAYOR'S CUP` completed-event modal and clicking its visible, unobscured, free `CLAIM` button once, then observing the resulting screen. Match the static title, completion label and button; exclude animated chests, sparkles, leaderboard portraits and scores. Chest motion alone must not reject an otherwise valid claim. A title match alone is insufficient when the button is absent, obscured or not free.

Preserve saved stops, exclusive input ownership, current target preflight and pending-input guards. Verify the actual result before any next input; do not retry an uncertain claim or infer undisclosed reward quantities. Existing implementation holds and attempt limits require the normal validated change process, not direct state edits. This policy establishes the desired behavior and authorization, not a claim that automatic recognition or execution has been installed. Success means chest animation does not prevent recognition of a valid completed-event CLAIM, while a missing or obscured button still blocks input.

## Observation Lifetime

The user removed train and airplane time recognition on 2026-10-05. Do not OCR their return or loading countdowns or calculate arrival deadlines. Use registered visible arrival indicators and current panel state. An empty airport has no current demand; a newly confirmed order replaces the temporary airport list. Repeated unchanged indicators do not justify reopening held work.

Reuse temporary observations within the current work until a relevant change. Preserve actual observation times; copying or reviewing evidence does not make it new. Do not recapture solely because 30 seconds or five minutes passed. Restart requires rebuilding order and shortage information from current screens.

Update affected facts after input. Market coordinates are local to a visit/frame and invalidate after purchase, scroll, close/reopen, refresh, or unexpected results. Bought boxes stay sold out while the window is open; remaining products shift forward after reopening.

Manual changes, purchases and deliveries can invalidate the affected temporary observations. Refresh them through useful order checks. Monitor restart preserves saved stops and original unresolved-input evidence, abandons the old action as unconfirmed after owner/input-idle checks, and grants no gameplay authority. Once those guards permit continuation, rebuild current orders rather than restoring a historical stock or order ledger.

## Screen Conduct and Records

Every input retains current device identity and geometry, epoch, target and critical-number preflight, one input owner, duplicate blocking, and post-input confirmation. For native Windows pointer input, prior foreground ownership is not required: the current hit-test at the intended point must belong to the unchanged game window and the point must be unobscured. The click may activate the game; confirm its result before any further input, including a possible activation-only first click. A green SEND button alone does not prove feasibility. Unknown input is never replayed. Hold an unsupported action or recognition-only order and return precise evidence to the manager; other supported work may continue under existing guards. Unknown/unresolved input or uncertain action results block all further game input until reconciled.

Offline development does not resume gameplay. Use [operator contracts](mumu-operator.md) and [implementation workflow](mumu-workflow.md). Keep routine reports to a brief outcome. Group exceptions only when they change what can proceed or require user action, and state their consequence and next required action. Completed-order archives, per-round narrative histories and inventory transaction records are not operational requirements. Keep evidence needed to resolve an outstanding input or a specific recognition defect; create separate narrative report files only when requested.
