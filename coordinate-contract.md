---
language: en-US
---

# Percentage Coordinate Contract

This is the required policy and implementation contract. Required behavior and installed enforcement are tracked separately in the [policy and installation status](C:/Users/djfal/Documents/Codex/2026-10-02/task/Township/remaining-implementation.md#policy-and-installation-status); passing a candidate review does not install it.

Reusable coordinates and every executable input use percentages, serialized as finite fractions: `0.5` means 50%. A command records `schema=1`, `unit=fraction`, `space=game`, its capture size, the reviewed game viewport and its normalized tap or swipe. The source frame ID and original hash bind the action. Input points satisfy `0 <= x < 1` and `0 <= y < 1`; the right and bottom edges are excluded.

The game viewport is relative to the original full-window capture. Convert a game point only at the guarded device boundary: `pixelX = viewport.x + round(x * viewport.width)` and `pixelY = viewport.y + round(y * viewport.height)`. Check the rounded point again; a fraction below 1 can still round onto an excluded edge. The Windows bridge independently checks the same fractions against its canonical permit and adds the verified desktop window origin only for native input. ADB uses its full game capture as the viewport. The retired Computer Use pilot records fractions against its official capture and remains under its existing pilot restrictions.

`percentageCommand` is mandatory for the Windows and ADB adapters. The retained integer `command` is derived evidence and must match exactly. A raw pixel command alone cannot execute. Percentage geometry is validated before creating the canonical action or reserving input. A source target outside the reviewed viewport therefore rejects with zero capture/input and leaves the state file unchanged; it must not become a new unknown action.

Active reusable recognition registrations contain `percentageGeometry` with `space=registered_capture`. Each fraction binds an actual JSON field path and its registered source canvas. Rectangles, market row positions/card dimensions/scroll geometry, and market/train local offsets are covered. Source provenance supplies the canvas for assets from different original sizes. JavaScript and Python resolve the same pixels and reject missing metadata, missing or duplicate paths, changed canvases and disagreeing pixel caches. They do not validate only detached copies in `coordinateBindings`.

Original PNG pixels, image hashes, native window geometry, OCR raster indices, masks and matching tolerances remain physical evidence or raster parameters. Percentage registrations do not grant support for arbitrary resizing. Recognition pixels are resolved at the source raster boundary; authorized game inputs are normalized against the current reviewed viewport afterward. Never reuse historical coordinates as current targets.

Hash-addressed historical profiles and action/preflight records remain immutable. Explicit historical profile loading can preserve an old issued proof; it does not permit a new pixel-only input. Offline authoring utilities re-encode percentages after a reviewed registration edit. Runtime loaders never repair, invent or silently fall back from missing percentages.

Keep viewport, frame/hash, process, HWND, DPI, capture size, scene/epoch, ownership, saved stops, authorization and result checks. Legacy input retains exact preflight. Per the user's 2026-10-09 change, SOM uses the bound decision observation directly without a second capture/analysis; native window geometry checks remain. Changed geometry invalidates the binding. Percentage conversion neither repairs a stale viewport nor authorizes extending it to contain a rejected target. Inspect and register the actual current game viewport separately at a settled boundary.

Prepare and validate changes in an isolated candidate. Retain the previous source and binary. Adopt the executable release and restart only at a settled boundary with no pending or unknown input, using the existing guarded commands. Preserve all unresolved-input evidence and saved stops. Offline tests and source preparation do not establish live input success.

## Application Status (2026-10-07)

The percentage candidate code, active registrations and exact bridge binary were installed and adopted on 2026-10-07 while resolving an actual Monitor viewport rejection. Current runtime installation and the separately observed preflight-expiry correction are recorded in the [canonical status index](C:/Users/djfal/Documents/Codex/2026-10-02/task/Township/remaining-implementation.md#policy-and-installation-status). Installation, input settlement and actual operating acceptance remain distinct; read actual stops and input state before live work.
