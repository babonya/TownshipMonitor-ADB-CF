"""Read only the title and screenshot-backed product tooltip state."""
import json
from pathlib import Path
from matching import ContractError, decode, digest
from image_assets import verified_asset
from frame_context import frame_pixels
from product_info import product_tooltips


def inspect_product_info(analyzer, data, base, *, context=None):
    path = Path(__file__).resolve().parents[2]/'reference/helicopter-product-info/profile.json'
    raw = path.read_bytes()
    config = json.loads(raw)
    image = frame_pixels(data, base, context)
    output = {**base, **analyzer.health(), 'productInfoProfileHash': digest(raw), 'productInfo': None}
    if config.get('schema') != 1 or config.get('dimensions') != {'width': image.shape[1], 'height': image.shape[0]}:
        return {**output, 'status': 'unsupported', 'reason': 'HELICOPTER_INFO_GEOMETRY_REQUIRED'}
    title = next(a for a in analyzer.profile['anchors'] if a['file'] == 'title.png')
    score, matched = analyzer.match(image, title, title['sourceBox'])
    if score < title['minimumScore']:
        return {**output, 'status': 'unsupported', 'reason': 'HELICOPTER_INFO_TITLE_REQUIRED'}
    markers = []
    for spec in config['markers']:
        asset = (path.parent/spec['file']).resolve()
        if asset.parent != path.parent:
            raise ContractError('HELICOPTER_INFO_ASSET_PATH_INVALID')
        markers.append(verified_asset(asset, spec['sha256'], 'HELICOPTER_INFO_ASSET_CHANGED').image)
    return {**output, 'status': 'candidate', 'scene': {'kind': 'helicopter'},
            'title': {'box': matched, 'matchScore': round(score, 6)},
            'productInfo': {'popups': product_tooltips(image, markers)}}
