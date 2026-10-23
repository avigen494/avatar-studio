#!/usr/bin/env bash
# Build and push the GPU worker image from any machine with Docker.
#   REGISTRY=ghcr.io/<owner> TAG=0.1 ./scripts/build-gpu-image.sh
# Then use $REGISTRY/avatar-gpu:$TAG as the RunPod container image.
set -euo pipefail
REGISTRY="${REGISTRY:?set REGISTRY, e.g. ghcr.io/your-github-user or docker.io/your-dockerhub-user}"
TAG="${TAG:-0.1}"
IMAGE="$REGISTRY/avatar-gpu:$TAG"
cd "$(dirname "$0")/../apps/gpu"
docker build --build-arg "IMAGE_TAG=avatar-gpu:$TAG" -t "$IMAGE" .
docker push "$IMAGE"
echo
echo "Pushed $IMAGE"
echo "RunPod -> Serverless -> New Endpoint -> Container Image: $IMAGE"
