"""Resolve path-bound profile percentages into exact source-raster regions."""
import copy
import math
import json
from pathlib import Path
POLICY = json.loads((Path(__file__).resolve().parents[2]/'reference/percentage-profile-policy.json').read_bytes())
if POLICY.get('schema') != 1:
    raise ValueError('PROFILE_PERCENTAGE_POLICY_INVALID')
AXES = POLICY['axes']
EXCLUDED = set(POLICY['excludedFields'])


def encode_percentage_profile(document, fallback=None):
    result = copy.deepcopy(document)
    result.pop('percentageGeometry', None)
    fallback = fallback or dict(POLICY['defaultCanvas'])
    entries = []
    source_canvases = {v.get('sourceHash'):v['dimensions'] for v in result.get('layouts',[]) if v.get('dimensions')}
    asset_canvases = {}
    for layout in result.get('layouts',[]):
        if not layout.get('dimensions'):
            continue
        assets = [value for key in POLICY['layoutAssetLists'] for value in layout.get(key, [])]
        for value in [*assets,*(layout.get(key) for key in POLICY['layoutAssetObjects'])]:
            if value and value.get('file'):
                asset_canvases[value['file']]=layout['dimensions']
    def walk(v, path, canvas):
        axis = AXES.get(path[-1] if path else '') or (POLICY['rowAxis'] if len(path)>1 and path[-2]==POLICY['rowField'] and type(v) is int else None)
        if axis and type(v) is int:
            entries.append({'kind':'scalar', 'axis':axis, 'path':path, 'canvas':dict(canvas), 'fraction':v/canvas[axis]})
            return
        if not isinstance(v, (dict, list)):
            return
        if isinstance(v, dict):
            canvas = v.get('dimensions', {'width': v['width'], 'height': v['height']} if type(v.get('width')) is int and type(v.get('height')) is int and 'x' not in v else source_canvases.get(v.get('sourceHash')) or asset_canvases.get(v.get('file')) or canvas)
            if all(type(v.get(k)) is int for k in ('x','y')) and 'width' not in v and 'height' not in v:
                entries.append({'kind':'point', 'path':path, 'canvas':dict(canvas), 'fraction':{'x':v['x']/canvas['width'], 'y':v['y']/canvas['height']}})
                return
            if all(type(v.get(k)) is int for k in ('x', 'y', 'width', 'height')) and v['x'] >= 0 and v['y'] >= 0 and v['width'] > 0 and v['height'] > 0 and v['x'] + v['width'] <= canvas['width'] and v['y'] + v['height'] <= canvas['height']:
                entries.append({'path': path, 'canvas': dict(canvas), 'fraction': {k: v[k] / canvas['width' if k in ('x', 'width') else 'height'] for k in ('x', 'y', 'width', 'height')}})
                return
            children = v.items()
        else:
            children = ((str(i), child) for i, child in enumerate(v))
        for k, child in children:
            if k not in EXCLUDED:
                walk(child, [*path, k], canvas)
    canvas = result.get('dimensions', {'width': result['width'], 'height': result['height']} if type(result.get('width')) is int and type(result.get('height')) is int and 'x' not in result else fallback)
    walk(result, [], canvas)
    result['percentageGeometry'] = {'schema': 1, 'unit': 'fraction', 'space': 'registered_capture', 'canvas': canvas, 'entries': entries}
    return result


def resolve_percentage_profile(document, historical=False):
    meta = document.get('percentageGeometry')
    if meta is None:
        if historical:
            return document  # Explicit immutable-history/offline migration only.
        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
    if meta.get('schema') != 1 or meta.get('unit') != 'fraction' or meta.get('space') != 'registered_capture' or not isinstance(meta.get('entries'), list):
        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
    result = copy.deepcopy(document)
    seen = set()
    for entry in meta['entries']:
        path, canvas, fraction = entry.get('path'), entry.get('canvas'), entry.get('fraction')
        if not isinstance(path, list) or not path or any(not isinstance(k, str) or k in ('__proto__', 'prototype', 'constructor') for k in path):
            raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
        key = tuple(path)
        if key in seen:
            raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
        seen.add(key)
        if not isinstance(canvas, dict) or any(type(canvas.get(k)) is not int or canvas[k] < 1 for k in ('width', 'height')):
            raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
        if entry.get('kind') in ('scalar','point'):
            try:
                parent=result
                for k in path[:-1]:
                    parent=parent[int(k)] if isinstance(parent,list) else parent[k]
                k=int(path[-1]) if isinstance(parent,list) else path[-1]
                old=parent[k]
                if entry['kind']=='scalar':
                    axis=entry.get('axis')
                    if axis not in ('width','height') or type(fraction) not in (int,float) or not math.isfinite(fraction) or type(old) is not int:
                        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
                    physical=math.floor(fraction*canvas[axis]+.5)
                    if physical!=old:
                        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
                    parent[k]=physical
                else:
                    if not isinstance(fraction,dict) or any(type(fraction.get(a)) not in (int,float) or not math.isfinite(fraction[a]) for a in ('x','y')):
                        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
                    physical={a:math.floor(fraction[a]*canvas['width' if a=='x' else 'height']+.5) for a in ('x','y')}
                    if any(type(old.get(a)) is not int or old[a]!=physical[a] for a in ('x','y')):
                        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
                    parent[k]={**old,**physical}
            except (KeyError,IndexError,TypeError,AttributeError):
                raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED') from None
            continue
        if not isinstance(fraction,dict):
            raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
        if any(type(fraction.get(k)) not in (int, float) or not math.isfinite(fraction[k]) for k in ('x', 'y', 'width', 'height')) or fraction['x'] < 0 or fraction['y'] < 0 or fraction['width'] <= 0 or fraction['height'] <= 0 or fraction['x'] + fraction['width'] > 1 + 1e-12 or fraction['y'] + fraction['height'] > 1 + 1e-12:
            raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
        parent = result
        try:
            for k in path[:-1]:
                parent = parent[int(k)] if isinstance(parent, list) else parent[k]
            k = int(path[-1]) if isinstance(parent, list) else path[-1]
            old = parent[k]
            physical = {name: math.floor(fraction[name] * canvas['width' if name in ('x', 'width') else 'height'] + .5) for name in ('x', 'y', 'width', 'height')}
            if any(old.get(name) != value for name, value in physical.items()):
                raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
            parent[k] = {**old, **physical}
        except (KeyError, IndexError, TypeError):
            raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED') from None
    encoded = encode_percentage_profile(result, meta['canvas'])['percentageGeometry']['entries']
    contracts = {tuple(e['path']): (e['canvas'],e.get('kind'),e.get('axis')) for e in encoded}
    if seen != set(contracts) or any((e['canvas'],e.get('kind'),e.get('axis')) != contracts.get(tuple(e['path'])) for e in meta['entries']):
        raise ValueError('PROFILE_PERCENTAGE_GEOMETRY_CHANGED')
    del result['percentageGeometry']
    return result
