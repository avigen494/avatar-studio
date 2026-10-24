"""
Build-time check: every engine's Python package must import on the build machine,
which has no GPU. A worker that dies at import shows only "exit code 1" on RunPod,
so this is the one place a missing or clashing library is cheap to find.

InfiniteTalk's wan/modules/t5.py calls torch.cuda.current_device() while a class
is being defined, so the few CUDA queries that run at import time are stubbed.
"""
from __future__ import annotations

import importlib
import os
import sys

import torch

torch.cuda.current_device = lambda: 0  # type: ignore[assignment]
torch.cuda.is_available = lambda: True  # type: ignore[assignment]
torch.cuda.device_count = lambda: 1  # type: ignore[assignment]
torch.cuda.get_device_capability = lambda *a, **k: (9, 0)  # type: ignore[assignment]


class _FakeDevice:
    """Answers any device property a library reads at import time."""

    major, minor, total_memory, name = 9, 0, 96 << 30, "build-check"
    gcnArchName, multi_processor_count, is_integrated, is_multi_gpu_board = "", 128, False, False

    def __getattr__(self, item: str):
        return "" if item.lower().endswith("name") else 0


torch.cuda.get_device_properties = lambda *a, **k: _FakeDevice()  # type: ignore[assignment]
torch.cuda.get_device_name = lambda *a, **k: "build-check"  # type: ignore[assignment]
torch.cuda.mem_get_info = lambda *a, **k: (96 << 30, 96 << 30)  # type: ignore[assignment]
torch.cuda.synchronize = lambda *a, **k: None  # type: ignore[assignment]

CHECKS = [
    ("/models/InfiniteTalk", "wan"),
    ("/models/Wan2.2", "wan"),
    ("/models/LatentSync", "latentsync"),
]

for path, mod in CHECKS:
    os.chdir(path)
    sys.path.insert(0, path)
    importlib.import_module(mod)
    print(f"[check] {mod} from {path} imports ok", flush=True)
    sys.path.pop(0)
    # Both Wan repos use the package name "wan"; drop it so the next one is imported fresh.
    for name in [n for n in sys.modules if n == mod or n.startswith(mod + ".")]:
        del sys.modules[name]

import basicsr  # noqa: E402
import gfpgan  # noqa: E402

print(f"[check] gfpgan {gfpgan.__version__} / basicsr {basicsr.__version__} import ok", flush=True)
