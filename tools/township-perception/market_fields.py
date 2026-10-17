"""Raster translation of percentage-registered market field regions."""
from matching import ContractError, box


def validate_fields(layout):
    try:
        fields = layout['fieldGeometry']
        for name, keys, space in [('card', ('iconBox','quantityBox','purchaseBox'), 'market_card'),
                                 ('currency', ('box',), 'market_coin')]:
            group = fields[name]
            width, height = group['dimensions']['width'], group['dimensions']['height']
            origin = group['origin']
            if group.get('schema') != 1 or group.get('space') != space or any(type(n) is not int for n in (width,height,origin['x'],origin['y'])):
                raise ValueError()
            if not (0 <= origin['x'] < width and 0 <= origin['y'] < height):
                raise ValueError()
            for key in keys:
                box(group[key], width, height)
            if name == 'card' and 'priceBox' in group:
                box(group['priceBox'], width, height)
    except (KeyError, TypeError, ValueError):
        raise ContractError('MARKET_FIELD_GEOMETRY_INVALID') from None


def field_box(group, field, anchor_x, anchor_y):
    region, origin = group[field], group['origin']
    return {'x': anchor_x + region['x'] - origin['x'], 'y': anchor_y + region['y'] - origin['y'],
            'width': region['width'], 'height': region['height']}
