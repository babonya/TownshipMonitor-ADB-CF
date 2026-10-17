"""Strict, role-specific OCR parsing. Never repair missing separators or digits."""
import math
import re
import unicodedata


def parse_field(raw_text, kind, scores, minimum_score=0.85):
    text = unicodedata.normalize("NFKC", raw_text)
    normalized = re.sub(r"\s+", "", text)
    base = {"rawText": raw_text, "normalizedText": normalized, "value": None, "status": "unknown", "reason": None}
    if (not scores or any(type(s) not in (int, float) or not math.isfinite(s) or not 0 <= s <= 1 for s in scores)
            or min(scores) < minimum_score):
        return {**base, "reason": "OCR_SCORE_INSUFFICIENT"}
    if kind == "text":
        value = text.strip() or None
    elif kind in ("stock_pair", "capacity"):
        match = re.fullmatch(r"([0-9]{1,6})/([0-9]{1,6})", normalized)
        if not match:
            return {**base, "reason": "PAIR_FORMAT_INVALID"}
        first, second = map(int, match.groups())
        if second == 0:
            return {**base, "reason": "PAIR_DENOMINATOR_INVALID"}
        value = ({"owned": first, "required": second} if kind == "stock_pair" else
                 {"used": first, "total": second, "free": max(0, second-first), "overCapacity": max(0, first-second)})
    elif kind in ("quantity", "bundle_quantity"):
        pattern = r"(?:[xX×])?([0-9]{1,6})" if kind == "bundle_quantity" else r"([0-9]{1,6})"
        match = re.fullmatch(pattern, normalized)
        value = int(match[1]) if match else None
        if kind == "bundle_quantity" and value == 0:
            value = None
    elif kind == "price_number":
        if re.fullmatch(r"(?:[0-9]{1,6}|[0-9]{1,3}(?:,[0-9]{3}){1,2})", normalized):
            value = {"amount": int(normalized.replace(",", "")), "currency": None}
        else:
            value = None
    else:
        raise ValueError("FIELD_KIND_UNSUPPORTED")
    return {**base, "value": value, "status": "parsed_candidate" if value is not None else "unknown",
            "reason": None if value is not None else "FIELD_FORMAT_INVALID"}
