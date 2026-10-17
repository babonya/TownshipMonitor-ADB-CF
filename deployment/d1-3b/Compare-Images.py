"""Read-only product-image comparison using the local D1 System One endpoint."""
import argparse
import base64
import hashlib
import json
import mimetypes
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image_a', type=Path)
    parser.add_argument('image_b', type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:8087/v1/systemone')
    parser.add_argument('--output', type=Path, help='Optional JSON result file')
    args = parser.parse_args()
    images, sources = [], []
    for path in (args.image_a, args.image_b):
        data = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0]
        if mime not in {'image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'}:
            parser.error(f'Unsupported image type: {path}')
        images.append(f'data:{mime};base64,' + base64.b64encode(data).decode('ascii'))
        sources.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(data).hexdigest()})
    payload = {
        'state': 'Two cropped product images from the game Township. Image 1 is the reference product; image 2 is a candidate product. Compare product identity only. Ignore quantities, prices, checkmarks, selection effects, backgrounds, and differences in scale.',
        'images': images,
        'questions': {
            'product_match': {
                'type': 'choice',
                'instructions': 'Do these two images show the same product?',
                'criteria': {
                    'same_product': 'Both images clearly show the same product.',
                    'different_product': 'The images show different products.',
                    'uncertain': 'The visible evidence is insufficient to decide whether the products match.'
                }
            }
        }
    }
    request = Request(args.url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
    start = time.perf_counter()
    try:
        with urlopen(request, timeout=120) as response:
            result = json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'HTTP {exc.code}: {exc.read().decode("utf-8", errors="replace")}') from exc
    except URLError as exc:
        raise RuntimeError(f'Cannot reach D1. Run Start-D1.ps1 first. {exc.reason}') from exc
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
    if 'product_match' not in result.get('answers', {}):
        raise RuntimeError(f'Unexpected System One response: {result}')
    report = {'request_elapsed_ms': elapsed_ms, 'images': sources, 'response': result,
              'note': 'Model probabilities are not calibrated for Township. This tool performs no purchases or game input.'}
    text = json.dumps(report, ensure_ascii=True, indent=2)
    if args.output:
        args.output.write_text(text + '\n', encoding='utf-8')
    print(text)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        sys.exit(1)
