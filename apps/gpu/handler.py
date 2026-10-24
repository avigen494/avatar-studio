"""
RunPod serverless handler for Avatar Studio.

One container image, several engines, all Apache-2.0 / MIT (hard rule 11):

  wan_s2v           Wan2.2-S2V-14B        photo + audio -> video      (Stage 0 candidate)
  infinitetalk      InfiniteTalk (I2V)    photo + audio -> video      (Stage 0 candidate)
  infinitetalk_v2v  InfiniteTalk (V2V)    real clip + audio -> video  (real-footage mode)
  latentsync        LatentSync 1.6        real clip + audio -> video  (mouth-only mode)
  finish            Real-ESRGAN + GFPGAN + RIFE                       (sharpen pass)

Job input (from apps/api/app/adapters/avatar/runpod.py):
  { task: "render"|"finish", engine, audio_url, image_url?, video_url?, style_url?,
    prompt, width, height, fps, steps, max_seconds?, upload_url }

The handler downloads only the files named in its job, writes everything
under a per-job folder, uploads the result with the presigned PUT it was
given, and deletes the folder in a `finally` block. Nothing is cached
between jobs and no user media stays on the GPU.

Model repos and weights are baked into the image by the Dockerfile; their
locations come from environment variables so the same handler runs on a
local box for Stage 0.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

import requests

# Code checkouts live in the image; WEIGHTS live on the network volume (see ensure_weights).
WEIGHTS_ROOT = Path(os.environ.get("WEIGHTS_ROOT", "/runpod-volume/models"))
WAN_DIR = Path(os.environ.get("WAN_DIR", "/models/Wan2.2"))
WAN_S2V_CKPT = Path(os.environ.get("WAN_S2V_CKPT", str(WEIGHTS_ROOT / "Wan2.2-S2V-14B")))
INFINITETALK_DIR = Path(os.environ.get("INFINITETALK_DIR", "/models/InfiniteTalk"))
INFINITETALK_WEIGHTS = Path(os.environ.get("INFINITETALK_WEIGHTS", str(WEIGHTS_ROOT / "weights")))
LATENTSYNC_DIR = Path(os.environ.get("LATENTSYNC_DIR", "/models/LatentSync"))
LATENTSYNC_CKPT = Path(os.environ.get("LATENTSYNC_CKPT", str(WEIGHTS_ROOT / "LatentSync-1.6")))
REALESRGAN_BIN = os.environ.get("REALESRGAN_BIN", "realesrgan-ncnn-vulkan")
GFPGAN_DIR = Path(os.environ.get("GFPGAN_DIR", "/models/GFPGAN"))
GFPGAN_WEIGHTS = Path(os.environ.get("GFPGAN_WEIGHTS", str(WEIGHTS_ROOT / "GFPGAN")))
RIFE_DIR = Path(os.environ.get("RIFE_DIR", "/models/Practical-RIFE"))
DIFFSYNTH_DIR = Path(os.environ.get("DIFFSYNTH_DIR", "/models/DiffSynth-Studio"))

# What ensure_weights() fetches: (Hugging Face repo, folder under WEIGHTS_ROOT, file that proves it is
# complete, allow patterns). The patterns matter: the full repos are 311 GB, the files we use are ~152 GB.
WEIGHT_SETS = [
    ("Wan-AI/Wan2.1-I2V-14B-480P", "weights/Wan2.1-I2V-14B-480P", "config.json", ["*.safetensors", "*.pth", "*.json", "*.txt", "*.model", "google/*", "xlm-roberta-large/*"]),
    ("TencentGameMate/chinese-wav2vec2-base", "weights/chinese-wav2vec2-base", "config.json", ["*.json", "pytorch_model.bin"]),
    ("MeiGen-AI/InfiniteTalk", "weights/InfiniteTalk", "single/infinitetalk.safetensors", ["single/*"]),
    ("Wan-AI/Wan2.2-S2V-14B", "Wan2.2-S2V-14B", "config.json", ["*.safetensors", "*.pth", "*.json", "*.txt", "*.model", "google/*", "wav2vec2-large-xlsr-53-english/*"]),
    ("ByteDance/LatentSync-1.6", "LatentSync-1.6", "latentsync_unet.pt", None),
]
# Folders an earlier, unfiltered download may have left behind; they are not used and waste the volume.
UNUSED_WEIGHT_DIRS = ["weights/InfiniteTalk/quant_models", "weights/InfiniteTalk/multi", "weights/InfiniteTalk/comfyui",
                      "weights/Wan2.1-I2V-14B-480P/assets", "weights/Wan2.1-I2V-14B-480P/examples", "Wan2.2-S2V-14B/assets"]
GFPGAN_URL = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth"
_WEIGHTS_READY = False


def ensure_weights() -> None:
    """
    Download any missing model weights into WEIGHTS_ROOT (the network volume).
    Runs once per container start; the first ever start on a fresh volume takes
    20-40 minutes for ~75 GB, every later start is instant. A lock file stops two
    workers from downloading the same set at once.
    """
    global _WEIGHTS_READY
    if _WEIGHTS_READY:
        return
    # Never download onto the container disk: the weights are ~75 GB and the disk is 30 GB.
    # The network volume must be mounted at the folder WEIGHTS_ROOT lives in.
    volume = WEIGHTS_ROOT.parent
    if str(volume).startswith("/runpod-volume") and not os.path.ismount(str(volume)):
        raise RuntimeError(
            f"Network volume is not mounted at {volume}. Attach the volume to the endpoint and set the "
            "template's volume mount path to /runpod-volume, then run the warm-up again."
        )
    WEIGHTS_ROOT.mkdir(parents=True, exist_ok=True)
    for rel in UNUSED_WEIGHT_DIRS:
        if (WEIGHTS_ROOT / rel).exists():
            print(f"[weights] removing unused {rel}", flush=True)
            shutil.rmtree(WEIGHTS_ROOT / rel, ignore_errors=True)
    free_gb = shutil.disk_usage(WEIGHTS_ROOT).free / 1e9
    print(f"[weights] root {WEIGHTS_ROOT} free {free_gb:.0f} GB (full set needs ~152 GB)", flush=True)
    lock = WEIGHTS_ROOT / ".download.lock"
    waited = 0
    while lock.exists() and waited < 3600:  # another worker is downloading
        if time.time() - lock.stat().st_mtime > 1800:  # left behind by a worker that was killed mid-download
            lock.unlink(missing_ok=True)
            break
        time.sleep(15)
        waited += 15
    missing = [w for w in WEIGHT_SETS if not (WEIGHTS_ROOT / w[1] / w[2]).exists()]
    gfpgan_file = GFPGAN_WEIGHTS / "GFPGANv1.4.pth"
    if missing or not gfpgan_file.exists():
        lock.write_text(str(os.getpid()))
        try:
            from huggingface_hub import snapshot_download

            for repo, sub, _marker, allow in missing:
                print(f"[weights] downloading {repo} -> {WEIGHTS_ROOT / sub} (patterns {allow})", flush=True)
                snapshot_download(repo_id=repo, local_dir=str(WEIGHTS_ROOT / sub), allow_patterns=allow,
                                  token=os.environ.get("HF_TOKEN") or None)
            if not gfpgan_file.exists():
                GFPGAN_WEIGHTS.mkdir(parents=True, exist_ok=True)
                download(GFPGAN_URL, gfpgan_file)
        finally:
            lock.unlink(missing_ok=True)
    # GFPGAN looks for its weights relative to its own folder; point that at the volume.
    target = GFPGAN_DIR / "experiments" / "pretrained_models"
    target.mkdir(parents=True, exist_ok=True)
    link = target / "GFPGANv1.4.pth"
    if not link.exists():
        os.symlink(gfpgan_file, link)
    _WEIGHTS_READY = True
PYTHON = os.environ.get("MODEL_PYTHON", "python")
IMAGE_TAG = os.environ.get("IMAGE_TAG", "avatar-gpu:dev")  # set at build time; reported on every job for pinning


def gpu_memory_gb() -> float:
    """Total memory of the first GPU in GB (0 if unknown)."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[0]
        return float(out) / 1024
    except Exception:  # noqa: BLE001
        return 0.0


def offload_flag() -> str:
    """CPU offloading keeps a 14B model inside 48 GB but costs a lot of time; skip it on big cards."""
    return "False" if gpu_memory_gb() >= 70 else "True"


def sh(cmd: list[str], cwd: Path | None = None) -> None:
    """Run a model command, stream its output to the worker log, and if it fails raise an
    error that carries the last lines of that output so the app can show the real reason."""
    print("+", " ".join(str(c) for c in cmd), flush=True)
    proc = subprocess.Popen([str(c) for c in cmd], cwd=str(cwd) if cwd else None,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    tail: list[str] = []  # meaningful lines (no debug chatter / progress bars)
    raw: list[str] = []  # the last lines exactly as printed
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end="", flush=True)
        text = line.rstrip()
        if not text.strip():
            continue
        raw.append(text[:300])
        if len(raw) > 25:
            raw.pop(0)
        if " DEBUG " not in text and "it/s]" not in text and "Warning" not in text:
            tail.append(text[:300])
            if len(tail) > 60:
                tail.pop(0)
    code = proc.wait()
    if code != 0:
        name = Path(str(cmd[1] if len(cmd) > 1 else cmd[0])).name
        detail = " | ".join(tail[-8:]) + " || RAW TAIL: " + " | ".join(raw[-15:])
        msg = f"{name} exited with code {code}: {detail}"
        if len(msg) > 3500:  # keep the END, where the exception is
            msg = msg[:400] + " ... " + msg[-3000:]
        raise RuntimeError(msg)


def download(url: str, dst: Path) -> Path:
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dst, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return dst


def upload(url: str, path: Path) -> None:
    with open(path, "rb") as f:
        r = requests.put(url, data=f, headers={"Content-Type": "video/mp4"}, timeout=600)
        r.raise_for_status()


def trim_audio(src: Path, dst: Path, max_seconds: float | None) -> Path:
    if not max_seconds:
        return src
    sh(["ffmpeg", "-y", "-v", "error", "-i", src, "-t", f"{max_seconds:.2f}", "-ac", "1", "-ar", "16000", dst])
    return dst


def mux(video: Path, audio: Path, out: Path, width: int, height: int, fps: int) -> Path:
    """Scale to the requested frame, attach the original audio, web-ready MP4."""
    sh(["ffmpeg", "-y", "-v", "error", "-i", video, "-i", audio,
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},fps={fps}",
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out])
    return out


def newest_mp4(folder: Path) -> Path:
    files = sorted(folder.rglob("*.mp4"), key=lambda p: p.stat().st_mtime)
    if not files:
        raise RuntimeError(f"No video produced in {folder}")
    return files[-1]


# --- engines -------------------------------------------------------------------
def run_wan_s2v(job: dict, work: Path, image: Path, audio: Path) -> Path:
    out_dir = work / "wan_out"
    out_dir.mkdir()
    # Wan2.2 S2V generate.py: speech-to-video with a reference image.
    # Wan2.2 S2V-14B accepts only two sizes; the finish pass scales and crops to the requested frame.
    size = "704*1024" if job["height"] >= job["width"] else "1024*704"
    sh([PYTHON, WAN_DIR / "generate.py", "--task", "s2v-14B", "--size", size, "--ckpt_dir", WAN_S2V_CKPT,
        "--offload_model", offload_flag(), "--convert_model_dtype", "--prompt", job["prompt"], "--image", image,
        "--audio", audio, "--sample_steps", str(job.get("steps", 20)), "--base_seed", str(job.get("seed") or 42),
        "--save_file", out_dir / "out.mp4"],
       cwd=WAN_DIR)
    return newest_mp4(out_dir)


def run_infinitetalk(job: dict, work: Path, media_path: Path, audio: Path, v2v: bool) -> Path:
    import json

    out_dir = work / "it_out"
    out_dir.mkdir()
    cond = {"prompt": job["prompt"], "cond_video": str(media_path), "cond_audio": {"person1": str(audio)}}
    (work / "input.json").write_text(json.dumps(cond))
    size = "infinitetalk-480" if max(job["width"], job["height"]) <= 854 else "infinitetalk-720"
    cmd = [PYTHON, INFINITETALK_DIR / "generate_infinitetalk.py",
           "--ckpt_dir", INFINITETALK_WEIGHTS / "Wan2.1-I2V-14B-480P",
           "--wav2vec_dir", INFINITETALK_WEIGHTS / "chinese-wav2vec2-base",
           "--infinitetalk_dir", INFINITETALK_WEIGHTS / "InfiniteTalk/single/infinitetalk.safetensors",
           "--input_json", work / "input.json", "--size", size, "--sample_steps", str(job.get("steps", 20)),
           "--mode", "streaming", "--motion_frame", "9", "--base_seed", str(job.get("seed") or 42),
           "--offload_model", offload_flag(),
           "--save_file", out_dir / "out"]
    if job.get("style_url"):
        cmd += ["--lora_dir", work / "style.safetensors", "--lora_scale", "1.0"]
    sh(cmd, cwd=INFINITETALK_DIR)
    return newest_mp4(out_dir)


def run_latentsync(job: dict, work: Path, video: Path, audio: Path) -> Path:
    out = work / "latentsync.mp4"
    sh([PYTHON, LATENTSYNC_DIR / "scripts" / "inference.py",
        "--unet_config_path", LATENTSYNC_DIR / "configs/unet/stage2_512.yaml",
        "--inference_ckpt_path", LATENTSYNC_CKPT / "latentsync_unet.pt",
        "--inference_steps", str(job.get("steps", 20)), "--guidance_scale", "1.5", "--seed", str(job.get("seed") or 1247),
        "--video_path", video, "--audio_path", audio, "--video_out_path", out], cwd=LATENTSYNC_DIR)
    return out


def run_finish(job: dict, work: Path, video: Path) -> Path:
    """Frames -> Real-ESRGAN x2 -> GFPGAN (light) -> RIFE (if fps up) -> encode."""
    frames = work / "frames"
    up = work / "up"
    frames.mkdir()
    up.mkdir()
    sh(["ffmpeg", "-y", "-v", "error", "-i", video, frames / "f_%06d.png"])
    sh([REALESRGAN_BIN, "-i", frames, "-o", up, "-n", "realesrgan-x2plus", "-s", "2", "-f", "png"])
    if os.environ.get("FINISH_FACE_RESTORE", "1") == "1" and GFPGAN_DIR.exists():
        restored = work / "restored"
        sh([PYTHON, GFPGAN_DIR / "inference_gfpgan.py", "-i", up, "-o", restored, "-v", "1.4", "-s", "1",
            "--weight", "0.3"], cwd=GFPGAN_DIR)
        src_frames = restored / "restored_imgs"
    else:
        src_frames = up
    audio = work / "finish_audio.m4a"
    sh(["ffmpeg", "-y", "-v", "error", "-i", video, "-vn", "-c:a", "copy", audio])
    tmp = work / "finish_tmp.mp4"
    sh(["ffmpeg", "-y", "-v", "error", "-framerate", "25", "-i", src_frames / "f_%06d.png", "-i", audio,
        "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", tmp])
    if int(job.get("fps", 25)) > 25 and RIFE_DIR.exists():
        out = work / "finish_rife.mp4"
        sh([PYTHON, RIFE_DIR / "inference_video.py", "--exp=1", f"--video={tmp}", f"--output={out}"], cwd=RIFE_DIR)
        tmp = out
    return tmp


def run_train_style(job: dict, work: Path, clips: list[Path]) -> Path:
    """
    Per-avatar LoRA on the Wan I2V base with DiffSynth-Studio (Apache-2.0).
    Footage is cut into 5-second, 81-frame clips at 480p; captions are a fixed
    identity token so the LoRA learns how THIS person moves and looks.
    """
    import json

    data = work / "train_data"
    data.mkdir()
    rows = []
    for ci, clip in enumerate(clips):
        seg_dir = data / f"c{ci}"
        seg_dir.mkdir()
        sh(["ffmpeg", "-y", "-v", "error", "-i", clip, "-vf", "scale=480:832:force_original_aspect_ratio=increase,crop=480:832,fps=16",
            "-an", "-f", "segment", "-segment_time", "5", "-reset_timestamps", "1", seg_dir / "seg_%03d.mp4"])
        for seg in sorted(seg_dir.glob("seg_*.mp4")):
            rows.append({"video": str(seg), "prompt": "a video of sks person talking to the camera, natural movement"})
    (data / "metadata.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    out_dir = work / "lora_out"
    out_dir.mkdir()
    sh([PYTHON, DIFFSYNTH_DIR / "examples" / "wanvideo" / "model_training" / "train.py",
        "--dataset_base_path", data, "--dataset_metadata_path", data / "metadata.jsonl",
        "--model_paths", json.dumps([str(INFINITETALK_WEIGHTS / "Wan2.1-I2V-14B-480P")]),
        "--height", "832", "--width", "480", "--num_frames", "81",
        "--lora_base_model", "dit", "--lora_target_modules", "q,k,v,o,ffn.0,ffn.2", "--lora_rank", str(job.get("rank", 32)),
        "--learning_rate", "1e-4", "--max_epochs", "1", "--max_steps", str(job.get("steps", 1500)),
        "--output_path", out_dir, "--use_gradient_checkpointing"], cwd=DIFFSYNTH_DIR)
    files = sorted(out_dir.rglob("*.safetensors"), key=lambda p: p.stat().st_mtime)
    if not files:
        raise RuntimeError("Training produced no style file")
    return files[-1]


def run_face_match(job: dict, work: Path, consent: Path, reference: Path, looks: list[Path]) -> dict:
    """InsightFace (buffalo_l, MIT): is the consent face the reference face, and do the looks match?"""
    import cv2
    import numpy as np
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))

    def embed_video(path: Path, samples: int = 5):
        cap = cv2.VideoCapture(str(path))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        embs = []
        for i in range(samples):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * (i + 0.5) / samples))
            ok, frame = cap.read()
            if not ok:
                continue
            faces = app.get(frame)
            if faces:
                embs.append(max(faces, key=lambda f: f.det_score).normed_embedding)
        cap.release()
        return np.mean(embs, axis=0) if embs else None

    def embed_image(path: Path):
        img = cv2.imread(str(path))
        faces = app.get(img) if img is not None else []
        return max(faces, key=lambda f: f.det_score).normed_embedding if faces else None

    c, r = embed_video(consent), embed_video(reference)
    if c is None or r is None:
        return {"ok": False, "reason": "No clear face found in the recording.", "consent_vs_reference": None}
    sim = float(np.dot(c, r) / (np.linalg.norm(c) * np.linalg.norm(r)))
    look_sims = []
    for lp in looks:
        e = embed_image(lp)
        look_sims.append(None if e is None else float(np.dot(e, r) / (np.linalg.norm(e) * np.linalg.norm(r))))
    threshold = float(job.get("threshold", 0.45))
    bad_looks = [i for i, s in enumerate(look_sims) if s is not None and s < threshold]
    ok = sim >= threshold and not bad_looks
    reason = "Consent face matches the reference." if ok else (
        "The consent recording does not look like the reference clip." if sim < threshold
        else "One of the looks does not match the person in the recording.")
    return {"ok": ok, "reason": reason, "consent_vs_reference": round(sim, 3), "look_scores": look_sims, "threshold": threshold}


def run_quality_check(job: dict, work: Path, output: Path, reference: Path) -> dict:
    """Is the face in the rendered video the face in the reference (clip or photo)? Per-frame minimum matters."""
    import cv2
    import numpy as np
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))

    def embed_image(img):
        faces = app.get(img) if img is not None else []
        return max(faces, key=lambda f: f.det_score).normed_embedding if faces else None

    def frames(path: Path, samples: int):
        cap = cv2.VideoCapture(str(path))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        for i in range(samples):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * (i + 0.5) / samples))
            ok, frame = cap.read()
            if ok:
                yield frame
        cap.release()

    if reference.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv"):
        embs = [e for e in (embed_image(f) for f in frames(reference, 5)) if e is not None]
        ref = np.mean(embs, axis=0) if embs else None
    else:
        ref = embed_image(cv2.imread(str(reference)))
    if ref is None:
        return {"ok": False, "similarity": None, "reason": "No clear face in the reference."}
    sims = []
    missing = 0
    for f in frames(output, 8):
        e = embed_image(f)
        if e is None:
            missing += 1
            continue
        sims.append(float(np.dot(e, ref) / (np.linalg.norm(e) * np.linalg.norm(ref))))
    if not sims:
        return {"ok": False, "similarity": None, "reason": "No face found in the rendered video."}
    threshold = float(job.get("threshold", 0.45))
    worst, mean = min(sims), sum(sims) / len(sims)
    ok = worst >= threshold and missing <= 2
    reason = "Face matches throughout." if ok else (
        f"Face drifts: lowest similarity {worst:.2f} (mean {mean:.2f})." if missing <= 2 else "Face missing in several frames.")
    return {"ok": ok, "similarity": round(worst, 3), "mean_similarity": round(mean, 3), "frames_without_face": missing,
            "threshold": threshold, "reason": reason}


# --- entry point ---------------------------------------------------------------
def handler(event: dict) -> dict:
    job = event.get("input") or {}
    started = time.time()
    work = Path(tempfile.mkdtemp(prefix="avatar-"))
    try:
        task = job.get("task", "render")
        if task == "warmup":
            ensure_weights()
            return {"ok": True, "image_tag": IMAGE_TAG, "weights_root": str(WEIGHTS_ROOT),
                    "gpu_seconds": round(time.time() - started, 1)}
        if task not in ("quality_check", "face_match"):
            ensure_weights()
        else:
            ensure_weights()  # InsightFace downloads its own small model on first use; keep the GFPGAN link fresh too
        if task == "train_style":
            clips = [download(u, work / f"clip_{i}.mp4") for i, u in enumerate(job["footage_urls"])]
            style = run_train_style(job, work, clips)
            with open(style, "rb") as f:
                requests.put(job["upload_url"], data=f, headers={"Content-Type": "application/octet-stream"}, timeout=600).raise_for_status()
            return {"ok": True, "gpu_seconds": round(time.time() - started, 1)}
        if task == "quality_check":
            out = download(job["output_url"], work / "output.mp4")
            ref_suffix = Path(job["reference_url"].split("?")[0]).suffix or ".mp4"
            ref = download(job["reference_url"], work / f"reference{ref_suffix}")
            result = run_quality_check(job, work, out, ref)
            result["gpu_seconds"] = round(time.time() - started, 1)
            result["image_tag"] = IMAGE_TAG
            return result
        if task == "face_match":
            consent = download(job["consent_url"], work / "consent.mp4")
            reference = download(job["reference_url"], work / "reference.mp4")
            looks = [download(u, work / f"look_{i}.jpg") for i, u in enumerate(job.get("look_urls", []))]
            result = run_face_match(job, work, consent, reference, looks)
            result["gpu_seconds"] = round(time.time() - started, 1)
            return result
        if task == "finish":
            src = download(job["video_url"], work / "in.mp4")
            out = run_finish(job, work, src)
            audio = work / "a.m4a"
            sh(["ffmpeg", "-y", "-v", "error", "-i", src, "-vn", "-c:a", "copy", audio])
            final = mux(out, audio, work / "final.mp4", job["width"], job["height"], job["fps"])
            upload(job["upload_url"], final)
            return {"ok": True, "gpu_seconds": round(time.time() - started, 1)}

        engine = job["engine"]
        audio_full = download(job["audio_url"], work / "voice.wav")
        audio = trim_audio(audio_full, work / "voice_trim.wav", job.get("max_seconds"))
        if job.get("style_url"):
            download(job["style_url"], work / "style.safetensors")
        image = download(job["image_url"], work / ("look" + (Path(job["image_url"].split("?")[0]).suffix or ".jpg"))) if job.get("image_url") else None
        video = download(job["video_url"], work / "reference.mp4") if job.get("video_url") else None

        if engine == "wan_s2v":
            raw = run_wan_s2v(job, work, image, audio)
        elif engine == "infinitetalk":
            raw = run_infinitetalk(job, work, image, audio, v2v=False)
        elif engine == "infinitetalk_v2v":
            raw = run_infinitetalk(job, work, video or image, audio, v2v=True)
        elif engine == "latentsync":
            raw = run_latentsync(job, work, video, audio)
        else:
            raise ValueError(f"Unknown engine {engine}")

        final = mux(raw, audio, work / "final.mp4", job["width"], job["height"], job["fps"])
        upload(job["upload_url"], final)
        return {"ok": True, "engine": engine, "gpu_seconds": round(time.time() - started, 1), "image_tag": IMAGE_TAG,
                "seed": job.get("seed")}
    except Exception as e:  # RunPod reports this as FAILED; the API shows a plain message and charges nothing
        traceback.print_exc()
        return {"error": f"{type(e).__name__}: {e}"[:4000]}
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    # A worker that dies within a second loses its traceback in the RunPod log viewer.
    # Print the error and stay alive long enough for the log shipper to catch it.
    try:
        import runpod

        print(f"[start] avatar-gpu {IMAGE_TAG}; weights root {WEIGHTS_ROOT}", flush=True)
        entry = handler
        # Developer switch: load the handler from a URL instead of the image, so a worker fix
        # does not need a 10-minute image build. Unset in production (no env var = no effect).
        override = os.environ.get("HANDLER_OVERRIDE_URL")
        if override:
            import importlib.util

            live = Path("/app/handler_live.py")
            download(override, live)
            spec = importlib.util.spec_from_file_location("handler_live", str(live))
            mod = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(mod)
            entry = mod.handler
            print("[start] handler loaded from HANDLER_OVERRIDE_URL (developer mode)", flush=True)
        runpod.serverless.start({"handler": entry})
    except BaseException:  # noqa: BLE001
        traceback.print_exc()
        print("[start] worker failed to start; see traceback above", flush=True)
        time.sleep(20)
        raise
