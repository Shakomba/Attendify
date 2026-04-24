"""CNN-based Presentation Attack Detection (PAD) via MiniFASNet ONNX models.

Uses MiniVision's Silent-Face-Anti-Spoofing pretrained models, exported to ONNX.
Two complementary scales run as an ensemble:
  - 2.7_80x80_MiniFASNetV2  — wider crop, captures screen bezels / hand / background
  - 4.0_0_0_80x80_MiniFASNetV1SE  — even wider, stronger against phone-screen replay

Each model outputs 3-class logits [class0, live, class2].  We softmax and take
index 1 (live) then average across both models.

Critical preprocessing (confirmed from MiniVision source data_io/functional.py):
  - Input range: raw float32 0..255 — NOT normalised to 0..1.
    MiniVision's custom to_tensor() calls img.float() only (no /255).
  - Crop: use CropImage._get_new_box logic — SHIFT window into frame bounds,
    do NOT zero-pad.  The model was trained on real image context.
  - bbox format fed into _crop_for_scale: (left, top, right, bottom).

Model files are loaded from `backend/app/models/pad/` at startup.  If they are
missing the detector reports available=False.  See scripts/convert_pad_models.py.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

_log = logging.getLogger("pad_cnn")

_MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "pad"

# (filename, crop_scale, input_size)
_MODEL_FILES: List[Tuple[str, float, int]] = [
    ("2.7_80x80_MiniFASNetV2.onnx", 2.7, 80),
    ("4_0_0_80x80_MiniFASNetV1SE.onnx", 4.0, 80),
]


@dataclass
class PadPrediction:
    is_live: bool
    live_score: float          # averaged live probability, 0..1
    available: bool            # False when no CNN weights are loaded
    per_model_scores: List[float] = field(default_factory=list)


class CnnPadDetector:
    """Low-level inference wrapper around the MiniFASNet ONNX ensemble."""

    def __init__(self, live_threshold: float = 0.55) -> None:
        self.live_threshold = live_threshold
        self._sessions: List[Tuple[object, float, int, str]] = []  # (session, scale, size, input_name)
        self.available = False
        self._load()

    def _load(self) -> None:
        try:
            import onnxruntime as ort  # noqa: F401
        except Exception as exc:  # pragma: no cover
            _log.warning("onnxruntime not installed — CNN PAD disabled: %s", exc)
            return

        import onnxruntime as ort  # second import so type checker sees it

        try:
            available_providers = ort.get_available_providers()
        except Exception:
            available_providers = ["CPUExecutionProvider"]

        providers: List[str] = []
        if "CUDAExecutionProvider" in available_providers:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")

        so = ort.SessionOptions()
        so.log_severity_level = 3  # suppress noisy warnings

        loaded = 0
        for fname, scale, size in _MODEL_FILES:
            path = _MODEL_DIR / fname
            if not path.exists():
                _log.warning("PAD model file not found: %s", path)
                continue
            try:
                sess = ort.InferenceSession(str(path), sess_options=so, providers=providers)
                input_name = sess.get_inputs()[0].name
                self._sessions.append((sess, scale, size, input_name))
                loaded += 1
                _log.info(
                    "PAD model loaded: %s (scale=%.2f, size=%d, providers=%s)",
                    fname, scale, size, sess.get_providers(),
                )
            except Exception as exc:
                _log.error("Failed to load PAD model %s: %s", fname, exc)

        if loaded == 0:
            _log.error(
                "No CNN PAD models loaded — anti-spoofing DISABLED. "
                "Place .onnx files in %s, or run scripts/convert_pad_models.py",
                _MODEL_DIR,
            )
            return

        self.available = True

    @staticmethod
    def _crop_for_scale(
        frame_bgr: np.ndarray,
        bbox: Tuple[int, int, int, int],
        scale: float,
        out_size: int,
    ) -> np.ndarray:
        """Exact port of MiniVision's CropImage._get_new_box + crop.

        bbox is (left, top, right, bottom) from the face detector.
        Internally converts to (x, y, w, h) as MiniVision expects.

        Key differences from naive approaches:
        - Shifts the crop window to stay inside the frame instead of zero-padding.
          The model was trained on real image context, not black borders.
        - Scales w and h independently (non-square source crop), then resizes.
        - Clamps scale so the window never exceeds the frame.
        """
        left, top, right, bottom = bbox
        bw = max(1, right - left)
        bh = max(1, bottom - top)
        x, y = left, top

        src_h, src_w = frame_bgr.shape[:2]

        # Clamp scale so crop stays within frame
        sc = min((src_h - 1) / bh, min((src_w - 1) / bw, scale))

        nw = bw * sc
        nh = bh * sc
        cx = bw / 2 + x
        cy = bh / 2 + y

        ltx = cx - nw / 2
        lty = cy - nh / 2
        rbx = cx + nw / 2
        rby = cy + nh / 2

        # Shift into frame bounds (no padding)
        if ltx < 0:
            rbx -= ltx
            ltx = 0
        if lty < 0:
            rby -= lty
            lty = 0
        if rbx > src_w - 1:
            ltx -= rbx - src_w + 1
            rbx = src_w - 1
        if rby > src_h - 1:
            lty -= rby - src_h + 1
            rby = src_h - 1

        crop = frame_bgr[int(lty): int(rby) + 1, int(ltx): int(rbx) + 1]
        if crop.size == 0:
            return np.zeros((out_size, out_size, 3), dtype=np.uint8)

        return cv2.resize(crop, (out_size, out_size), interpolation=cv2.INTER_LINEAR)

    @staticmethod
    def _softmax(logits: np.ndarray) -> np.ndarray:
        shifted = logits - np.max(logits, axis=-1, keepdims=True)
        exp = np.exp(shifted)
        return exp / (np.sum(exp, axis=-1, keepdims=True) + 1e-9)

    def predict(self, frame_bgr: np.ndarray, bbox: Tuple[int, int, int, int]) -> PadPrediction:
        if not self.available or frame_bgr is None or frame_bgr.size == 0:
            return PadPrediction(is_live=True, live_score=1.0, available=False)

        scores: List[float] = []

        for sess, scale, size, input_name in self._sessions:
            try:
                crop = self._crop_for_scale(frame_bgr, bbox, scale, size)

                # MiniFASNet's to_tensor returns raw float32 (NOT /255).
                # MiniVision's custom transform.py does img.float() only.
                tensor = np.transpose(crop.astype(np.float32), (2, 0, 1))
                tensor = np.expand_dims(tensor, axis=0)

                raw = sess.run(None, {input_name: tensor})[0]
                probs = self._softmax(raw)
                # Class 1 = live in MiniVision's convention
                live_prob = float(probs[0, 1])
                if not math.isfinite(live_prob):
                    continue
                scores.append(live_prob)
            except Exception as exc:
                _log.error("PAD inference error (scale=%.2f): %s", scale, exc)
                continue

        if not scores:
            # All inferences failed; be conservative and don't block the user,
            # but surface that the check was inconclusive.
            return PadPrediction(is_live=True, live_score=0.5, available=False)

        avg = float(sum(scores) / len(scores))
        return PadPrediction(
            is_live=avg >= self.live_threshold,
            live_score=round(avg, 4),
            available=True,
            per_model_scores=[round(s, 4) for s in scores],
        )
