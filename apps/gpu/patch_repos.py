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

SDPA_HELPER = "\n".join([
    "",
    "",
    "def _avatar_sdpa(q, k, v, attn_bias=None):",
    "    # avatar-studio: xformers picks a Hopper-only kernel on Blackwell cards and fails;",
    "    # PyTorch attention gives the same result. Inputs are (B, M, H, K) like xformers.",
    "    assert attn_bias is None, 'sequence-parallel attention is not supported in this build'",
    "    out = torch.nn.functional.scaled_dot_product_attention(",
    "        q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2))",
    "    return out.transpose(1, 2)",
    "",
]) + "\n"

XFORMERS_CALLS = [
    ("xformers.ops.memory_efficient_attention(q, encoder_k, encoder_v, attn_bias=attn_bias, op=None,)",
     "_avatar_sdpa(q, encoder_k, encoder_v, attn_bias=attn_bias)"),
    ("xformers.ops.memory_efficient_attention(q, encoder_k, encoder_v, attn_bias=None, op=None,)",
     "_avatar_sdpa(q, encoder_k, encoder_v)"),
]


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
    rest = src[end:]
    ds = re.match(r'\s*"""(?:.|\n)*?"""\n', rest)  # skip a docstring if the function has one
    if ds:
        end += ds.end()
    src = src[:end] + FALLBACK + src[end:]
    path.write_text(src, encoding="utf-8")
    print(f"[patch] {path}: flash_attention() falls back to SDPA")


def replace_xformers_attention(path: Path) -> None:
    """InfiniteTalk's audio cross-attention calls xformers.ops.memory_efficient_attention, which
    dispatches to a Hopper flash kernel that crashes on Blackwell GPUs. Use PyTorch attention."""
    src = path.read_text(encoding="utf-8")
    if "_avatar_sdpa" in src:
        print(f"[patch] {path}: already patched")
        return
    for old, _new in XFORMERS_CALLS:
        if old not in src:
            sys.exit(f"[patch] {path}: expected call not found: {old}")
    for old, new in XFORMERS_CALLS:
        src = src.replace(old, new)
    anchor = "import xformers.ops\n"
    if anchor not in src:
        sys.exit(f"[patch] {path}: 'import xformers.ops' not found")
    src = src.replace(anchor, anchor + SDPA_HELPER, 1)
    path.write_text(src, encoding="utf-8")
    print(f"[patch] {path}: xformers attention replaced by PyTorch attention")


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
    replace_xformers_attention(Path("/models/InfiniteTalk/wan/modules/attention.py"))
    drop_argspec_import(Path("/models/InfiniteTalk/wan/multitalk.py"))
