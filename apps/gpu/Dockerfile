# Avatar Studio GPU worker image for RunPod serverless.
# Base: CUDA 12.8 + PyTorch 2.8, so the same image runs on A40/L40S/H100 and on the
# Blackwell cards (RTX PRO 6000 96 GB). Every model here is Apache-2.0 / MIT / BSD.
#
# Model WEIGHTS are not baked in. They live on a RunPod network volume
# (mounted at /runpod-volume) and are downloaded once by handler.ensure_weights()
# on the first start. That keeps this image small (code + Python deps only),
# so cold starts are fast and rebuilding after a code change takes minutes.
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

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
# The four model repos pin conflicting library versions (LatentSync pins old ones, Wan2.2 and
# InfiniteTalk need newer). This set satisfies all of them and is installed last so it wins.
RUN pip install "diffusers==0.33.1" "transformers==4.51.3" "tokenizers>=0.21,<0.22" "accelerate>=1.1.1,<2"     "huggingface_hub>=0.30,<1" "numpy==1.26.4" "peft>=0.14" "xfuser>=0.4.1"
# basicsr (used by GFPGAN) imports a torchvision module that was removed in torchvision 0.17.
RUN f=$(python -c "import importlib.util; print(importlib.util.find_spec('basicsr').submodule_search_locations[0])")/data/degradations.py     && sed -i "s/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/" "$f"
# flash-attn is optional for every engine (they fall back to PyTorch attention) and the version
# pip finds is rejected by diffusers' version check, so make sure it is absent.
RUN pip uninstall -y flash-attn flash_attn || true
# Some model repos pin an older torch in their requirements; put the CUDA 12.8 build back last so
# the image keeps working on Blackwell GPUs.
RUN pip install --force-reinstall --no-deps torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128 \
    && pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128 \
    && pip install xformers==0.0.32.post2 --index-url https://download.pytorch.org/whl/cu128     && python -c "import torch, xformers; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'xformers', xformers.__version__)"
# mediapipe (LatentSync) ships protobuf 3 generated code; the pure-Python protobuf runtime accepts it.
ENV PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python

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
# Fail the build, not the first worker, if the handler cannot even be imported.
RUN python -c "import runpod, requests, torch; print('runpod', runpod.__version__, 'torch', torch.__version__)" \
    && python -c "import importlib.util; s=importlib.util.spec_from_file_location('handler','/app/handler.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print('handler imports ok')"     && python -c "import diffusers.pipelines.pipeline_utils, transformers, accelerate; from accelerate.utils.memory import clear_device_cache; print('diffusers', diffusers.__version__, 'transformers', transformers.__version__, 'accelerate', accelerate.__version__)"     && cd /models/InfiniteTalk && python -c "import wan; print('infinitetalk imports ok')"     && cd /models/Wan2.2 && python -c "import wan; print('wan2.2 imports ok')"     && cd /models/LatentSync && python -c "import latentsync; print('latentsync imports ok')"     && python -c "import gfpgan, basicsr; print('gfpgan imports ok')"
CMD ["python", "-u", "/app/handler.py"]
