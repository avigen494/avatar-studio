# Stage 0 run sheet — pick the default photo-mode engine

Goal: three scored 60-second videos (same script, same audio, same photo) from Wan2.2-S2V-14B and InfiniteTalk, plus a real-footage sample from InfiniteTalk V2V, rated by a 5-person blind panel against HeyGen Avatar V. Output: `docs/STAGE0_RESULTS.md` with scores, cost per minute and the chosen `DEFAULT_ENGINE_PHOTO`.

## The short way: Settings → Engine Lab

The app has a page for this whole sheet. Steps:

1. Build and push `apps/gpu` (see `apps/gpu/README.md`), create a RunPod serverless endpoint (L40S first), and paste the API key and endpoint id in **Settings → Connections → RunPod**. Set Render backend to `runpod`, the GPU name and the hourly price. Press Test.
2. Open **Settings → Engine Lab**. Paste the test script, pick your cloned voice, upload the photo and the 45-second real clip, and the HeyGen Avatar V render of the same script as the benchmark.
3. Tick `wan_s2v`, `infinitetalk`, `infinitetalk_v2v` and press **Run selected**. Each trial records wall time, GPU seconds and cost per minute.
4. Turn on **Blind mode**, hand the phone to each of the five viewers, and let them score every clip (lip sync, motion, identity, would you post it) and guess which is HeyGen.
5. Read the **Summary**. Press **Adopt as default** on the winner. Press **Export results** and save the file as `docs/STAGE0_RESULTS.md`.

Repeat monthly with the same inputs (PRD section 8). The manual steps below are for running outside the app.

## 1. Inputs (prepare once, reuse for every monthly panel)

- `stage0/script.txt` — the 60-second test script (150 words, English, one Hinglish line).
- `stage0/voice.wav` — the script spoken by the cloned voice (ElevenLabs), 24 kHz mono.
- `stage0/look.jpg` — a well-lit front-facing photo, 1080×1920.
- `stage0/reference.mp4` — 45-second real clip (talking, hands visible), 1080×1920.
- `stage0/heygen_v.mp4` — the same script rendered on HeyGen Avatar V (the benchmark).

## 2. Machine

RunPod pod (not serverless) with the `apps/gpu` image: L40S 48 GB first, H100 80 GB second. Record the hourly price of each.

```bash
docker run --gpus all -it -v $PWD/stage0:/stage0 <registry>/avatar-gpu:0.1 bash
```

## 3. Runs

Run each from Python inside the container, timing with `time`:

```python
from handler import handler
base = {"audio_url": "file:///stage0/voice.wav", "prompt": "calm relaxed face, looking at the camera; natural talking, subtle head movement, stable framing, no camera motion",
        "width": 720, "height": 1280, "fps": 25, "steps": 20, "upload_url": "file:///stage0/out.mp4"}
# (for local files, replace download()/upload() in handler.py with shutil copies, or serve /stage0 with `python -m http.server`)
handler({"input": {**base, "task": "render", "engine": "wan_s2v", "image_url": "http://localhost:8080/look.jpg"}})
handler({"input": {**base, "task": "render", "engine": "infinitetalk", "image_url": "http://localhost:8080/look.jpg"}})
handler({"input": {**base, "task": "render", "engine": "infinitetalk_v2v", "video_url": "http://localhost:8080/reference.mp4"}})
handler({"input": {"task": "finish", "video_url": "http://localhost:8080/out_wan.mp4", "width": 1080, "height": 1920, "fps": 25, "upload_url": "..."}})
```

For each run note: wall time, peak VRAM (`nvidia-smi --query-gpu=memory.used --format=csv -l 5`), GPU-hours × price = cost, cost per finished minute.

## 4. Panel

Five viewers, phones, blind order. Each watches the four clips (HeyGen V, wan_s2v, infinitetalk, infinitetalk_v2v) and scores 1–5 on:

1. Lip sync accuracy
2. Natural head and body motion
3. Identity (looks like the person)
4. Overall "would you post this Reel?"

Also ask: "Which one is the real HeyGen?" Record the guess.

## 5. Decide

- Photo mode default = the higher average of wan_s2v vs infinitetalk (tie → cheaper per minute). Set `DEFAULT_ENGINE_PHOTO`.
- If infinitetalk_v2v averages ≥ 4.2, real-footage mode goes to the top of v2.
- Any engine under 3.0 is dropped.
- Preview time: a 15-second render must return in under 3 minutes on the chosen GPU, else keep one warm worker.

## 6. Write `docs/STAGE0_RESULTS.md`

Table: engine · GPU · wall time · VRAM · cost/min · panel avg (×4 criteria) · "guessed as HeyGen" count. One paragraph: the decision and why.
