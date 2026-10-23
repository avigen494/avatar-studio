# Avatar Studio GPU worker image for RunPod serverless.
# Base: CUDA 12.4 + PyTorch 2.4. Every model here is Apache-2.0 / MIT / BSD.
#
# Model WEIGHTS are not baked in. They live on a RunPod network volume
# (mounted at /runpod-volume) and are downloaded once by handler.ensure_weights()
# on the first start. That keeps this image small (code + Python deps only),
# so cold starts are fast and rebuilding after a code change takes minutes.
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 HF_HUB_ENABLE_HF_TRANSFER=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git git-lfs libgl1 libglib2.0-0 wget unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /models

# --- InfiniteTalk (Apache-2.0): photo/video + audio -> talking video --------
RUN git clone --depth 1 https://github.com/MeiGen-AI/InfiniteTalk.git && \
    pip install -r InfiniteTalk/requirements.txt && (pip install flash-attn --no-build-isolation || true)

# --- Wan2.2 (Apache-2.0): S2V-14B speech-to-video ------------------------------
RUN git clone --depth 1 https://github.com/Wan-Video/Wan2.2.git && pip install -r Wan2.2/requirements.txt

# --- LatentSync 1.6 (Apache-2.0): mouth-only lip-sync --------------------------
RUN git clone --depth 1 https://github.com/bytedance/LatentSync.git && pip install -r LatentSync/requirements.txt

# --- Finish pass: Real-ESRGAN (BSD-3), GFPGAN (Apache-2.0), Practical-RIFE (MIT)
RUN wget -q https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip \
    && unzip -q realesrgan-ncnn-vulkan-20220424-ubuntu.zip -d realesrgan && chmod +x realesrgan/realesrgan-ncnn-vulkan \
    && ln -s /models/realesrgan/realesrgan-ncnn-vulkan /usr/local/bin/realesrgan-ncnn-vulkan && rm *.zip
RUN git clone --depth 1 https://github.com/TencentARC/GFPGAN.git && pip install -r GFPGAN/requirements.txt && pip install -e GFPGAN
RUN git clone --depth 1 https://github.com/hzwer/Practical-RIFE.git

# --- v2: style training (DiffSynth-Studio, Apache-2.0) and face match (InsightFace, MIT)
RUN git clone --depth 1 https://github.com/modelscope/DiffSynth-Studio.git && pip install -e DiffSynth-Studio
RUN pip install insightface onnxruntime-gpu opencv-python-headless "huggingface_hub[cli]" hf_transfer runpod requests

# Weights root on the network volume. Override WEIGHTS_ROOT to keep them elsewhere.
ENV WEIGHTS_ROOT=/runpod-volume/models
ENV WAN_DIR=/models/Wan2.2 INFINITETALK_DIR=/models/InfiniteTalk LATENTSYNC_DIR=/models/LatentSync \
    GFPGAN_DIR=/models/GFPGAN RIFE_DIR=/models/Practical-RIFE DIFFSYNTH_DIR=/models/DiffSynth-Studio

# Pin: pass --build-arg IMAGE_TAG=avatar-gpu:0.2 so every render records which image made it.
ARG IMAGE_TAG=avatar-gpu:dev
ENV IMAGE_TAG=$IMAGE_TAG

# Works whether the build context is the repo root (RunPod GitHub builds) or apps/gpu (local builds).
WORKDIR /app
COPY . /src
RUN if [ -f /src/handler.py ]; then cp /src/handler.py /app/handler.py; else cp /src/apps/gpu/handler.py /app/handler.py; fi     && rm -rf /src
CMD ["python", "-u", "/app/handler.py"]
