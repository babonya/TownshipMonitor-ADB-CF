"""Byte-only asset verification; callers retain their own path policies."""
import hashlib
from dataclasses import dataclass

import cv2
import numpy as np


class ContractError(ValueError):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode(data: bytes):
    # Bound dimensions BEFORE decoding a potentially huge PNG.
    if len(data) > 8 * 1024 * 1024 or len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ContractError("PNG_INVALID")
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if not (0 < width <= 4096 and 0 < height <= 4096 and width * height <= 8_000_000):
        raise ContractError("PNG_GEOMETRY_UNSUPPORTED")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[:2] != (height, width):
        raise ContractError("PNG_INVALID")
    return image


@dataclass(frozen=True)
class VerifiedAsset:
    data: bytes
    sha256: str
    image: np.ndarray


def verified_asset(path, expected_hash, hash_error, *, decoder=decode):
    data = path.read_bytes()
    sha256 = digest(data)
    if sha256 != expected_hash:
        raise ContractError(hash_error)
    return VerifiedAsset(data, sha256, decoder(data))
