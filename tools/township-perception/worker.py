"""Persistent JSONL matching worker and one-file offline CLI. Never sends input."""
import argparse
import base64
import json
import sys
from pathlib import Path

from matching import ContractError, Matcher
from jsonl_protocol import MAX_LINE, emit, serve
from frame_context import FrameContext


def request(matcher, message, slots=None, helicopter=None, market=None, catalogue=None):
    if not isinstance(message, dict):
        raise ContractError("REQUEST_INVALID")
    op = message.get("op")
    if op == "health":
        return {**matcher.health(), **(slots.health() if slots else {}), **(helicopter.health() if helicopter else {}), **(market.health() if market else {}), **(catalogue.health() if catalogue else {})}
    if op not in ("match", "match_slots", "helicopter", "helicopter_info", "market", "product_regions", "barn_sale"):
        raise ContractError("OP_UNSUPPORTED")
    if type(message.get("offline", False)) is not bool:
        raise ContractError("OFFLINE_FLAG_INVALID")
    data = base64.b64decode(message["imageBase64"], validate=True)
    def specialized_context():
        context = FrameContext.read(data, message.get('frame'))
        # Specialized observations retain their own scene checks and require preflight.
        base = matcher.analyze(data, message.get('frame'), offline=True, objects=False, context=context)
        return context, base
    if op == 'barn_sale':
        from barn_sale import BarnSaleAnalyzer
        if not hasattr(matcher,'barn_sale'):matcher.barn_sale=BarnSaleAnalyzer()
        context,base=specialized_context()
        return {**base,'barnSale':matcher.barn_sale.analyze(context.image)}
    if op == 'helicopter_info':
        if helicopter is None:raise ContractError('HELICOPTER_PROFILE_REQUIRED')
        from helicopter_info import inspect_product_info
        context,base=specialized_context()
        return inspect_product_info(helicopter,data,base,context=context)
    if op == 'market':
        if market is None:raise ContractError('MARKET_PROFILE_REQUIRED')
        context,base=specialized_context()
        return market.analyze(data,base,context=context)
    if op == 'product_regions':
        if catalogue is None:raise ContractError('CATALOGUE_REQUIRED')
        context,base=specialized_context()
        image=context.image
        regions=message.get('productRegions')
        if not isinstance(regions,list) or not 1<=len(regions)<=32:raise ContractError('PRODUCT_REGIONS_INVALID')
        return {**base,**catalogue.health(),'productIdentities':[
            {'slotId':r['slotId'],**catalogue.match(image,r['box'],'delivery',scales=r.get('scales'),overlay_top=r.get('overlayTop'),native_item=r.get('nativeItemId'))} for r in regions]}
    if op == 'helicopter':
        if helicopter is None:raise ContractError('HELICOPTER_PROFILE_REQUIRED')
        context,base=specialized_context()
        icons_only=message.get('customerIconsOnly',False)
        if type(icons_only) is not bool:raise ContractError('CUSTOMER_ICON_SCOPE_INVALID')
        return helicopter.analyze(data,base,customer_icons_only=icons_only,context=context)
    if op == "match_slots":
        if slots is None:
            raise ContractError("LAYOUTS_UNAVAILABLE")
        return slots.analyze(data, message.get("frame"), message.get("layoutId"), offline=message.get("offline", False))
    return matcher.analyze(data, message.get("frame"), offline=message.get("offline", False), scope=message.get("scope", "all"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--layouts")
    parser.add_argument("--helicopter-profile")
    parser.add_argument("--market-profile")
    parser.add_argument("--catalogue-manifest")
    parser.add_argument("--product-thresholds")
    parser.add_argument("--catalogue-products", action="store_true", help="Enable explicit catalogue region analysis alongside screenshot-only helicopter recognition")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--image")
    parser.add_argument("--metadata")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    matcher = Matcher(args.registry)
    slots = None
    helicopter = None
    market = None
    catalogue = None
    root=Path(__file__).resolve().parents[2]
    manifest=Path(args.catalogue_manifest) if args.catalogue_manifest else root/'reference/product-upper-crops/manifest.json'
    thresholds=Path(args.product_thresholds) if args.product_thresholds else root/'reference/product-recognition/thresholds.json'
    if args.helicopter_profile:
        from helicopter import HelicopterAnalyzer
        helicopter = HelicopterAnalyzer(args.helicopter_profile)
    needs_catalogue = (helicopter is None or not helicopter.screenshot_products_only or
                       args.market_profile or args.catalogue_products or args.catalogue_manifest or args.product_thresholds)
    if needs_catalogue and manifest.exists() and thresholds.exists():
        from catalogue import ProductCatalogueMatcher
        catalogue=ProductCatalogueMatcher(manifest,thresholds)
    if args.market_profile:
        from market import MarketPerception
        market=MarketPerception(args.market_profile,catalogue=catalogue)
    if helicopter and not helicopter.screenshot_products_only:
        helicopter.catalogue = catalogue
    if args.layouts:
        from slots import SlotAnalyzer
        slots = SlotAnalyzer(matcher, args.layouts)
    if not args.serve:
        if not args.image or not args.metadata:
            parser.error("--image and --metadata are required without --serve")
        frame = json.loads(Path(args.metadata).read_text(encoding="utf-8-sig"))
        emit({"ok": True, "result": matcher.analyze(Path(args.image).read_bytes(), frame, offline=args.offline)})
        return
    serve(lambda message: request(matcher, message, slots, helicopter, market, catalogue),
          request(matcher, {'op': 'health'}, slots, helicopter, market, catalogue))


if __name__ == "__main__":
    # Keep native Windows console codepages from corrupting JSON labels.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
