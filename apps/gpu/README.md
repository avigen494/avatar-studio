# GPU worker (RunPod serverless)

One image, four render engines, the finish pass, style training, face match and the quality check. All models carry commercial licences (Apache-2.0 / MIT / BSD-3). CodeFormer is **not** included: its licence is non-commercial, so the light face-restore step uses GFPGAN (Apache-2.0) instead.

| Engine key | Model | Used for |
| --- | --- | --- |
| `wan_s2v` | Wan2.2-S2V-14B | Photo mode (Stage 0 candidate) |
| `infinitetalk` | InfiniteTalk (image to video) | Photo mode (Stage 0 candidate) |
| `infinitetalk_v2v` | InfiniteTalk (video to video) | Real-footage mode |
| `latentsync` | LatentSync 1.6 | Mouth-only mode |
| task `finish` | Real-ESRGAN x2 + GFPGAN 1.4 (weight 0.3) + RIFE | 1080p / 4K finish |
| task `train_style` | DiffSynth-Studio LoRA on the Wan I2V base (rank 32, 1500 steps) | Teach it my style (v2) |
| task `face_match` | InsightFace buffalo_l | Consent face vs reference vs looks (v2) |
| task `quality_check` | InsightFace buffalo_l | Output face vs reference, per frame (consistency gate) |
| task `warmup` | downloads weights | First start on a new volume |

The image holds code and Python dependencies only. **Model weights (about 152 GB) live on a RunPod network volume** and are downloaded once, on the first start, by `handler.ensure_weights()`. Later starts find them in place.

## Setting up RunPod, step by step

**1. Account and credit.** Sign up at runpod.io. Billing → add credit. The whole Stage 0 bake-off costs roughly $15 to $30 on an L40S; the network volume costs about $0.07 per GB per month (a 250 GB volume is about $17 a month).

**2. API key.** Settings → API Keys → Create API Key → permission **Read & Write**. Copy it; it is shown once.

**3. Network volume for the weights.** Storage → Network Volumes → **New Network Volume**: name `avatar-weights`, size **250 GB**, data center: pick one that lists **L40S** (or H100) as available, and note which one. The endpoint must be created in the same data center.

**4. The image.** Two ways:

- *GitHub Actions (recommended once the repo is on GitHub)*: push the repo; the workflow `.github/workflows/gpu-image.yml` builds `apps/gpu` and pushes `ghcr.io/<your-github-user>/avatar-gpu:latest`. After the first run, open GitHub → Packages → avatar-gpu → Package settings → **Change visibility → Public**, or add the GHCR credentials in RunPod → Settings → Container Registry Auth.
- *Any machine with Docker*: `REGISTRY=ghcr.io/<user> TAG=0.1 ./scripts/build-gpu-image.sh`.

**5. Serverless endpoint.** Serverless → **New Endpoint**:

| Setting | Value |
| --- | --- |
| Container image | `ghcr.io/<your-github-user>/avatar-gpu:latest` |
| Container disk | 30 GB |
| GPU | 48 GB tier (L40S) for Stage 0; 80 GB (H100) when training style files |
| Active (min) workers | 0 to start; 1 during Indian daytime later to kill cold starts |
| Max workers | 2 |
| Idle timeout | 60 s |
| Execution timeout | 3600 s (style training can take over an hour) |
| FlashBoot | On |
| Network volume | `avatar-weights` (step 3) |
| Environment variables | `HF_TOKEN` only if a model repo is gated for you; nothing else is needed |

Create it and copy the **Endpoint ID** (the short id in the endpoint URL).

**6. Connect it in the app.** Settings → Connections → RunPod: paste the API key and endpoint id, set **Render backend** to `runpod`, **GPU** to `L40S 48GB`, **GPU price** to about 70 (₹ per hour at current L40S pricing), leave the quality gate on. Press **Test**. It should say the endpoint is reachable.

**7. Warm up once.** The first job on a fresh volume downloads the weights, which takes 20 to 40 minutes. Run a single Engine Lab trial (mock inputs are fine) and let it finish; everything after that starts in under a minute. You can watch progress in RunPod → the endpoint → Logs (lines starting with `[weights]`).

**8. Run Stage 0** from Settings → Engine Lab (see `docs/STAGE0_RUNSHEET.md`).

## Job contract

Input: `{ task: "render"|"finish"|"train_style"|"face_match"|"quality_check"|"warmup", engine, audio_url, image_url?, video_url?, style_url?, prompt, width, height, fps, steps, seed, max_seconds?, upload_url }`

Output: `{ ok: true, gpu_seconds, image_tag, seed }` or `{ error }`. Rendered files are PUT to `upload_url` by the handler; nothing large comes back through RunPod. `image_tag` is recorded on every video so you always know which image made it.

## Local run on any CUDA box

Set `WEIGHTS_ROOT` to a local folder and the `*_DIR` variables to your checkouts, then call `handler({"input": {...}})` from Python. The first call downloads the weights into `WEIGHTS_ROOT`.
