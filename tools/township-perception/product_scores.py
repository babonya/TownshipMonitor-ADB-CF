"""Reduce scores within one already-validated spatial scope."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ProductSelection:
    best: dict | None
    runner: dict | None
    margin: float | None
    status: str

    @property
    def matched(self):
        return self.status == 'matched_candidate'


def select_product(candidates, *, require_competitor=False):
    identities = {}
    for candidate in candidates:
        previous = identities.get(candidate['itemId'])
        if previous is None or candidate['score'] > previous['score']:
            identities[candidate['itemId']] = candidate
    ranked = sorted(identities.values(), key=lambda candidate: candidate['score'], reverse=True)
    best = ranked[0] if ranked else None
    runner = ranked[1] if len(ranked) > 1 else None
    margin = best['score'] - runner['score'] if runner else None
    supported = best is not None and best['score'] >= best['minimumScore']
    ambiguous = supported and margin is not None and margin < best['minimumMargin']
    matched = supported and not ambiguous and (runner is not None or not require_competitor)
    return ProductSelection(best, runner, margin, 'matched_candidate' if matched else 'ambiguous' if ambiguous else 'unknown')
