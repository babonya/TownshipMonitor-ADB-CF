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


# ADB helicopter deletion and common market session

Agreed by the user on 2026-10-13. This policy supersedes the Android SOM
30-minute, no-deliverable-orders market-return reset. Windows SOM and legacy
quantity policies are outside this change.

## Decisions

### Permanent user exclusions - 2026-10-14

The two user-selected gray and gold ingot artworks in
`reference/som/permanent-failed-products.json` are permanently failed in Android
SOM. Their registered scope is the 1544x720 helicopter screen. Preserve both
across every market refresh, new session, restart and checkpoint failure. Match
the current requested artwork through the existing comparison path; never shop
for or send an order containing either, including an otherwise ready order.
The existing readable-order, current-target, source binding and inclusive
fifteen-minute deletion gates still apply. Defer or skip when deletion is not
currently allowed. Full original game capture, hashes and fractional crop regions
are retained with the registry. These fixed exclusions are policy assets, not
restored inventory or order history, and remain visible in the failed-product
section independently of the temporary market checkpoint.

### Temporary market failures

1. Skip positively recognized order-refresh panels; never use SPEED UP.
2. Deliver an order whose occupied slots all have readable sufficient amounts.
   This takes priority even when it requests a temporary failed product; the
   permanent user exclusions above remain excluded.
3. Reobserve an unread product/amount decision once on a fresh frame of the same
   current order. If still unread, delete that order when the common timer allows.
   A recognized order panel, current trash target, frame/hash and percentage
   geometry are mandatory. Unread screen/target geometry never authorizes input.
4. A short order requesting any failed product is deleted without shopping,
   including when that product's own slot is sufficient. Match requested crops
   against the failed products; do not identify orders by customer or history.
5. A confirmed purchase followed by a fresh return observation of the requested
   product still short counts one failure. Count each purchase result once across
   all orders and rereads. The first failure defers registration;
   the second such failure in this market session marks the
   original requested product as failed, not the possibly misrecognized offer.
   Rejected/interrupted/unconfirmed purchases do not count. Counts accumulate
   within the session and are not cleared by a delivery or another market visit.
   Apart from mandatory permanent-exclusion checks, ready delivery must not
   await optional SOM comparison. Do not store ready
   crops or infer post-delivery stock consumption to exempt a purchase result.
   Only a current matching shortage evaluates the pending purchase; a sufficient
   slot or another ready order does not retire it. No order/product relationship
   or cause of the shortage is inferred. The user changed the threshold from three to two on 2026-10-14.
   The sufficient-artwork exemption remains removed.
6. Two completed not-found searches in the same refresh-period session mark the
   original requested product failed. A complete geometrically verified
   beginning-to-end scan qualifies. The user additionally treats a current
   verified all-visible-cards-SOLD observation as market-search completion
   (2026-10-14): on the existing visit exit, count unattempted known needs even
   when rightEdgeComplete, terminalVerified or exhausted is false. The SOLD
   path uses soldOutView: a recognized market with complete current card
   coverage, all visible cells sold, and no popup or motion. It does not require
   earlier scan.complete or a separate +/edge marker. Existing visit start,
   session/scope, unknown-offer and per-product uncertainty guards still apply.
   Bind current requested artwork before an early SOLD exit. Do not count
   attempted products, timer-only visits, or repeat finishes of the same visit.
   SOLD exit/scroll actions remain unchanged; scrolling proposals do not count
   until the visit actually finishes with a qualifying current observation.
   The first qualifying search increments a separate not-found count and keeps
   the product eligible. Preserve the count in the existing checkpoint.
   Either two not-found searches OR two confirmed purchase-return shortages
   independently register a failed product. One of each does not qualify.
   Non-SOLD early returns (purchase batch, barn recovery, scroll limit or lost
   geometry) do not establish full-search absence; uncertain needs are deferred.
7. Continue shopping for needs with remaining opportunities. Never buy a failed
   product again in the same session, even when deletion is temporarily deferred.

## Common session and timer

One in-memory session spans visits within a single market refresh period. It owns the common
timer evidence/deadline and product crops, failure counts and unevaluated purchase
results. The current market session is atomically checkpointed to
`.monitor/market-session.json` with a checksum and device/session binding. Reuse
it when the last successful save is no more than three minutes old, including
exactly three minutes. Save during owned decision updates and on normal worker
shutdown; forced shutdown uses the last successful save. Missing, unreadable,
malformed, checksum-invalid, future-dated, mismatched or older files start a
new market session. An expired market deadline also starts a new session.
Use the existing native startup timestamp for a new GUI incarnation so delayed
worker readiness does not turn a timely restart into an expired checkpoint.
The market deadline itself is always checked against the current time.

Only the market timer, product crops, failure counts/flags and confirmed pending
purchase evaluations are reused. Current orders, shopping visits, navigation,
unread-order retries and game inputs are always reconstructed from current
screens. Preserve failed requested crops as review evidence separately; the
archive directory is not the checkpoint and is never loaded for decisions.

Read the existing NEW OFFERS IN timer OCR on the first valid unobscured market
observation of each entry. A missing/unread timer may use one fresh retry; do not
wait indefinitely or reinterpret it as a refresh. Deadline is capture time plus
remaining duration, not OCR completion time. Elsewhere compute remaining time
from that deadline without polling the market.

An observed deadline extended beyond display/capture precision means a manual
refresh; an elapsed recorded deadline expires the session immediately. Preserve
failed crops and clear all temporary product counts, failures, pending purchase
evaluations and incomplete visit evidence. Long inactivity expires once, without
replaying missed periods. The next entry establishes the next deadline. At
any refresh detected after shopping has begun, end that visit without reusing
its scan, offer memory, attempts or product IDs. Reobserve current orders before
starting a fresh visit under the new session.
At explicit stop/resume or process restart, reuse only an eligible checkpoint
under the three-minute rule above (user update, 2026-10-14). External-play recovery
still discards the market decision context. A restored timer keeps its original
absolute deadline and the existing fifteen-minute deletion gate. On the next
normal market entry, current timer evidence detects any refresh.

The required-goods interface also shows a separate `실패 상품` section for the
active market session, using its requested-product crops and failure reason.
Market expiration, a fresh session or failed checkpoint restoration clears
temporary failure tiles. The two permanent policy tiles remain. Historical
archive images are not shown as active failures.

Every deletion reason needs a known live common deadline with at least 15 minutes
remaining, inclusive at exactly 15 minutes, both when planning and immediately
before native input. Below 15 minutes, skip affected orders and continue other
work; do not shop for failed products or wait on the order panel. Unknown/expired
timer defers deletion and permits one normal market entry to establish time.

## Comparisons and input evidence

Reuse SomClient.match for product identity, ignoring quantity/check overlays.
Use requested-product crops to group session products and to connect current
shortages to unevaluated purchases. Compare requested crops of short orders to
failed products. Crop hashes alone do not prove identity after visual changes.
An uncertain comparison gets one fresh observation retry; if still uncertain,
delete only the current order subject to timer and target guards, without adding
an unidentified product to the failed set.

Source frame/hash, profile/viewport scope, current order and current trash binding
remain mandatory. Stops, exclusive ownership, device guards and unresolved-input
holds remain enforced. Deletion is successful only after the existing verified
result transition; a click alone is insufficient. Normal delivery never clears
the common market session.

## Validation

Exercise the second-purchase-shortage boundary and duplicate observations/orders, requested versus
offer identity, ready-order priority, failed requested slots that are already
sufficient, uncertainty retry with fresh same-order binding, complete versus
partial search, timer entry cadence, manual extension, elapsed expiry and
cross-refresh visit invalidation. Test the exact 15-minute boundary and elapsed
pre-input rejection, source/geometry/target negatives and destructive-result
holds. Use saved Android originals for perception/integration and one independent
fixed-candidate review before installation. Activate at a stopped owner-free,
input-settled boundary, adopt executable identity, restart and verify continuous
Android SOM operation from fresh frames.
