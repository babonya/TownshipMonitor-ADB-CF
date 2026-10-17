"""Recognize the supplied PRODUCTS MISSING title and its current close X."""
from barn_full import BarnFullDetector


class ProductsMissingDetector(BarnFullDetector):
    def detect(self, im, panel):
        # Reuse the registered static-lettering matcher and measured panel scale.
        # The parent locates each anchor inside panel-relative fractional regions.
        found=super().detect(im,panel)
        return found if found and 'title' in found['anchors'] else None
