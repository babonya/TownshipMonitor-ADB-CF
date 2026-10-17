"""Town camera landmarks only. These features never prove an unobscured UI."""
import cv2
import numpy as np


def town_features(image):
    height, width = image.shape[:2]
    if (width, height) != (1600, 900):
        return []
    mask = np.zeros((height, width), np.uint8)
    # Fixed HUD, badges, bottom shortcuts and edge event buttons are excluded.
    mask[175:715, 185:1410] = 255
    points, descriptors = cv2.ORB_create(nfeatures=240).detectAndCompute(image, mask)
    if descriptors is None:
        return []
    return [{'x': round(point.pt[0], 2), 'y': round(point.pt[1], 2), 'descriptor': bytes(row).hex()}
            for point, row in zip(points, descriptors)]
