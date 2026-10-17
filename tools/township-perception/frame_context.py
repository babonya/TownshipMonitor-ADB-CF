"""Validated bytes and pixels shared only within one perception request."""
import copy
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from types import MappingProxyType
from image_assets import ContractError, decode, digest


def timestamp(value: str) -> float:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.timestamp() * 1000
    except (ValueError, AttributeError, TypeError):
        raise ContractError("OBSERVED_AT_INVALID") from None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(freeze(item) for item in value)
    return value


@dataclass(frozen=True)
class FrameContext:
    data: bytes
    frame: object
    image: object
    observed_ms: float

    @classmethod
    def read(cls, data, frame):
        if not isinstance(frame, dict) or not isinstance(frame.get('frameId'), str) or not frame['frameId']:
            raise ContractError('FRAME_REQUIRED')
        if type(frame.get('sequence')) is not int or frame['sequence'] < 0 or type(frame.get('epoch')) is not int or frame['epoch'] < 0:
            raise ContractError('FRAME_SEQUENCE_INVALID')
        data = bytes(data)
        if frame.get('evidenceHash') != digest(data):
            raise ContractError('FRAME_HASH_MISMATCH')
        observed_ms = timestamp(frame.get('observedAt'))
        image = decode(data)
        image.flags.writeable = False
        return cls(data, freeze(copy.deepcopy(frame)), image, observed_ms)

    def require_binding(self, data, frame):
        if data != self.data or freeze(frame) != self.frame:
            raise ContractError('FRAME_CONTEXT_MISMATCH')

    def age_ms(self, now_ms=None):
        return (time.time()*1000 if now_ms is None else now_ms)-self.observed_ms


def frame_pixels(data, base, context=None):
    if context is None:
        return decode(data)
    if data != context.data or any(base.get(key) != context.frame.get(key) for key in ('frameId','evidenceHash','sequence','epoch','observedAt')):
        raise ContractError('FRAME_CONTEXT_MISMATCH')
    return context.image
