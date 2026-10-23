"""
Image generation adapter for the v2 look generator and camera angles.

  FalImageEngine   fal.ai (Flux Kontext): same person, new outfit / setting / angle
  MockImageEngine  ffmpeg colour and crop variants of the reference photo

Prompt text comes from prompts/look.v1.md (P6); this module only fills it.
"""
from __future__ import annotations

import base64
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import settings
from app.services import media
from app.services.prompts import render
from app.services.runtime_config import cfg

FAL_MODEL = "fal-ai/flux-pro/kontext"  # image editing with a reference, commercial use allowed


@dataclass
class LookRequest:
    reference_path: Path
    outfit: str = "same outfit"
    setting: str = "same background"
    lighting: str = "soft natural light"
    framing: str = "medium shot, facing camera"
    count: int = 3
    width: int = 768
    height: int = 1344


class ImageEngine(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def generate_looks(self, req: LookRequest, out_dir: Path) -> list[Path]: ...

    @abstractmethod
    def generate_from_text(self, prompt: str, negative: str, count: int, width: int, height: int, out_dir: Path,
                           hint: str = "") -> list[Path]:
        """Design-with-AI: a brand-new person from a text prompt (prompts/design.v1.md). `hint` is the avatar name."""


def build_prompt(req: LookRequest) -> tuple[str, str]:
    text = render("look", {"outfit": req.outfit, "setting": req.setting, "lighting": req.lighting, "framing": req.framing})
    positive, _, negative = text.partition("\nNegative:")
    return positive.strip(), negative.strip()


class MockImageEngine(ImageEngine):
    """Keeps the person identical (it is the same photo) and changes colour grade and crop."""

    name = "mock"
    _GRADES = ["eq=brightness=0.03:saturation=1.15", "curves=preset=vintage", "eq=contrast=1.1:saturation=0.85,hue=h=8"]

    def available(self) -> bool:
        return True

    def generate_looks(self, req: LookRequest, out_dir: Path) -> list[Path]:
        outs = []
        for i in range(req.count):
            grade = self._GRADES[i % len(self._GRADES)]
            zoom = 1.0 + 0.08 * (i % 3)
            out = out_dir / f"look_{i + 1}.jpg"
            vf = (f"scale=iw*{zoom}:ih*{zoom},crop={req.width}:{req.height}:(iw-{req.width})/2:(ih-{req.height})/2,"
                  f"{grade}") if zoom > 1 else f"scale={req.width}:{req.height}:force_original_aspect_ratio=increase,crop={req.width}:{req.height},{grade}"
            vf = f"scale={req.width * 2}:{req.height * 2}:force_original_aspect_ratio=increase,crop={req.width * 2}:{req.height * 2}," \
                 f"scale=iw*{zoom}:ih*{zoom},crop={req.width}:{req.height},{grade}"
            media.run([settings.ffmpeg_bin, "-y", "-v", "error", "-i", str(req.reference_path), "-vf", vf,
                       "-frames:v", "1", "-q:v", "3", str(out)])
            outs.append(out)
        return outs


    def generate_from_text(self, prompt: str, negative: str, count: int, width: int, height: int, out_dir: Path,
                           hint: str = "") -> list[Path]:
        """Placeholder portraits: a soft gradient with the avatar initials, different hue per candidate."""
        outs = []
        words = [w for w in (hint or "").split() if w[:1].isalpha()]
        initials = ("".join(w[0] for w in words[:2]).upper() if words else "AV")
        font = media.find_font()
        for i in range(count):
            hue = (i * 97) % 360
            out = out_dir / f"design_{i + 1}.jpg"
            vf = f"hue=h={hue}"
            if font:
                vf += (f",drawtext=fontfile='{font}':text='{initials}':fontcolor=white@0.9:fontsize={height // 5}:"
                       f"x=(w-text_w)/2:y=(h-text_h)/2")
            try:
                media.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i",
                           f"gradients=s={width}x{height}:c0=0x0f766e:c1=0x1e293b:nb_colors=2", "-vf", vf,
                           "-frames:v", "1", "-q:v", "3", str(out)])
            except media.MediaError:
                media.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i",
                           f"gradients=s={width}x{height}:c0=0x0f766e:c1=0x1e293b:nb_colors=2", "-vf", f"hue=h={hue}",
                           "-frames:v", "1", "-q:v", "3", str(out)])
            outs.append(out)
        return outs


class FalImageEngine(ImageEngine):
    name = "fal"
    TEXT_MODEL = "fal-ai/flux/dev"

    def available(self) -> bool:
        return bool(cfg("fal_api_key"))

    def generate_from_text(self, prompt: str, negative: str, count: int, width: int, height: int, out_dir: Path,
                           hint: str = "") -> list[Path]:
        key = cfg("fal_api_key")
        if not key:
            raise RuntimeError("fal.ai is not connected. Add the key in Settings → Connections.")
        headers = {"Authorization": f"Key {key}", "Content-Type": "application/json"}
        payload = {"prompt": prompt, "num_images": count, "image_size": {"width": width, "height": height},
                   "num_inference_steps": 28, "guidance_scale": 3.5, "enable_safety_checker": True, "output_format": "jpeg"}
        with httpx.Client(timeout=60) as client:
            r = client.post(f"https://queue.fal.run/{self.TEXT_MODEL}", headers=headers, json=payload)
            r.raise_for_status()
            sub = r.json()
            deadline = time.time() + 300
            while time.time() < deadline:
                s = client.get(sub["status_url"], headers=headers).json()
                if s.get("status") == "COMPLETED":
                    break
                if s.get("status") in ("FAILED", "ERROR"):
                    raise RuntimeError("fal.ai could not design the avatar.")
                time.sleep(2)
            else:
                raise RuntimeError("fal.ai took too long.")
            result = client.get(sub["response_url"], headers=headers).json()
            outs = []
            for i, img in enumerate(result.get("images", [])[:count]):
                out = out_dir / f"design_{i + 1}.jpg"
                out.write_bytes(client.get(img["url"], timeout=60).content)
                outs.append(out)
        if not outs:
            raise RuntimeError("fal.ai returned no images.")
        return outs

    def generate_looks(self, req: LookRequest, out_dir: Path) -> list[Path]:
        key = cfg("fal_api_key")
        if not key:
            raise RuntimeError("fal.ai is not connected. Add the key in Settings → Connections.")
        positive, _negative = build_prompt(req)
        data = req.reference_path.read_bytes()
        mime = "image/png" if req.reference_path.suffix.lower() == ".png" else "image/jpeg"
        image_url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
        headers = {"Authorization": f"Key {key}", "Content-Type": "application/json"}
        payload = {"prompt": positive, "image_url": image_url, "num_images": req.count, "guidance_scale": 3.5,
                   "output_format": "jpeg", "safety_tolerance": "2",
                   "aspect_ratio": "9:16" if req.height > req.width else ("1:1" if req.height == req.width else "16:9")}
        with httpx.Client(timeout=60) as client:
            r = client.post(f"https://queue.fal.run/{FAL_MODEL}", headers=headers, json=payload)
            r.raise_for_status()
            sub = r.json()
            status_url, response_url = sub["status_url"], sub["response_url"]
            deadline = time.time() + 300
            while time.time() < deadline:
                s = client.get(status_url, headers=headers).json()
                if s.get("status") == "COMPLETED":
                    break
                if s.get("status") in ("FAILED", "ERROR"):
                    raise RuntimeError("fal.ai could not generate the look.")
                time.sleep(2)
            else:
                raise RuntimeError("fal.ai took too long.")
            result = client.get(response_url, headers=headers).json()
            outs = []
            for i, img in enumerate(result.get("images", [])[: req.count]):
                out = out_dir / f"look_{i + 1}.jpg"
                out.write_bytes(client.get(img["url"], timeout=60).content)
                outs.append(out)
        if not outs:
            raise RuntimeError("fal.ai returned no images.")
        return outs


def get_image_engine() -> ImageEngine:
    fal = FalImageEngine()
    return fal if fal.available() else MockImageEngine()
