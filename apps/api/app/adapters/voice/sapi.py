"""
Windows built-in speech (SAPI) through PowerShell. Dev-only convenience so a
local render speaks real words without any API key. Not used in production.
"""
from __future__ import annotations

import platform
import subprocess
from pathlib import Path

from app.adapters.voice.base import LibraryVoice, SynthesisRequest, SynthesisResult, VoiceEngine
from app.services.media import duration_seconds, to_wav


class SapiVoiceEngine(VoiceEngine):
    name = "sapi"

    def available(self) -> bool:
        return platform.system() == "Windows"

    def list_library(self) -> list[LibraryVoice]:
        if not self.available():
            return []
        try:
            script = (
                "Add-Type -AssemblyName System.Speech; "
                "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | "
                "ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name + '|' + $_.VoiceInfo.Gender }"
            )
            out = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True, timeout=30)
            voices = []
            for line in out.stdout.splitlines():
                parts = line.strip().split("|")
                if len(parts) == 3:
                    lang = "hi" if parts[1].lower().startswith("hi") else "en"
                    voices.append(LibraryVoice(parts[0], f"{parts[0]} (Windows)", lang, parts[2].lower()))
            return voices
        except Exception:
            return []

    def clone(self, name: str, sample_path: Path, api_key: str | None = None) -> str:
        raise NotImplementedError("Windows speech cannot clone voices. Use ElevenLabs.")

    def synthesize(self, req: SynthesisRequest, out_dir: Path) -> SynthesisResult:
        raw = out_dir / "voice_sapi.wav"
        text_file = out_dir / "voice_text.txt"
        text_file.write_text(req.text, encoding="utf-8")
        select = f"$s.SelectVoice('{req.external_voice_id}'); " if req.external_voice_id else ""
        script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"try {{ {select} }} catch {{ }} "
            f"$s.SetOutputToWaveFile('{raw}'); "
            f"$t = Get-Content -Raw -Encoding UTF8 '{text_file}'; "
            "$s.Speak($t); $s.Dispose()"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, capture_output=True, timeout=600)
        out = out_dir / "voice.wav"
        to_wav(raw, out)
        return SynthesisResult(path=out, duration_s=duration_seconds(out), engine=self.name)
