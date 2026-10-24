"""
Build-time patches to the cloned model repos. Each patch is small, idempotent and explained.
Run once by the Dockerfile after the repos are cloned; the build fails loudly if a patch no
longer applies, which means the upstream file changed and the patch must be reviewed.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FALLBACK = (
    "    if not (FLASH_ATTN_2_AVAILABLE or FLASH_ATTN_3_AVAILABLE):\n"
    "        # avatar-studio: flash-attn is not installed (no Blackwell wheel); use the SDPA path below.\n"
    "        return attention(q, k, v, q_lens=q_lens, k_lens=k_lens, dropout_p=dropout_p,\n"
    "                         softmax_scale=softmax_scale, q_scale=q_scale, causal=causal,\n"
    "                         window_size=window_size, deterministic=deterministic, dtype=dtype)\n"
)


def patch_flash_attention(path: Path) -> None:
    """Wan2.2 and InfiniteTalk call flash_attention() directly from their model code and assert
    that flash-attn is installed, although the module's attention() wrapper already has a
    scaled_dot_product_attention fallback. Route the direct calls through that fallback."""
    src = path.read_text(encoding="utf-8")
    if "avatar-studio: flash-attn is not installed" in src:
        print(f"[patch] {path}: already patched")
        return
    m = re.search(r"^def flash_attention\((?:.|\n)*?\):\n", src, re.M)
    if not m:
        sys.exit(f"[patch] {path}: flash_attention() signature not found; review the patch")
    end = m.end()
    # Skip a docstring if the function starts with one.
    rest = src[end:]
    ds = re.match(r'\s*"""(?:.|\n)*?"""\n', rest)
    if ds:
        end += ds.end()
    src = src[:end] + FALLBACK + src[end:]
    path.write_text(src, encoding="utf-8")
    print(f"[patch] {path}: flash_attention() falls back to SDPA")


def drop_argspec_import(path: Path) -> None:
    """InfiniteTalk imports inspect.ArgSpec, removed in Python 3.11; the name is never used."""
    src = path.read_text(encoding="utf-8")
    new = src.replace("from inspect import ArgSpec\n", "")
    if new != src:
        path.write_text(new, encoding="utf-8")
        print(f"[patch] {path}: removed unused ArgSpec import")
    else:
        print(f"[patch] {path}: ArgSpec import already absent")


if __name__ == "__main__":
    patch_flash_attention(Path("/models/Wan2.2/wan/modules/attention.py"))
    patch_flash_attention(Path("/models/InfiniteTalk/wan/modules/attention.py"))
    drop_argspec_import(Path("/models/InfiniteTalk/wan/multitalk.py"))
