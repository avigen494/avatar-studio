"""
Warm up the RunPod endpoint: start one worker and let it download the model
weights onto the network volume. Run once after creating the endpoint (and
again after wiping the volume). Prints progress until the job finishes.

    cd apps/api && .venv\\Scripts\\python ..\\..\\scripts\\runpod_warmup.py

Safe to rerun: if a job is already waiting or running on the endpoint it does
not submit another one, it just follows the endpoint until that job finishes.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

import httpx  # noqa: E402

from app.services.runtime_config import cfg  # noqa: E402

key, endpoint = cfg("runpod_api_key"), cfg("runpod_endpoint_id")
if not (key and endpoint):
    sys.exit("RunPod is not connected. Add the key and endpoint id in Settings -> Connections first.")
base = f"https://api.runpod.ai/v2/{endpoint}"
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

HINT = (
    "No worker has started. Open RunPod -> Serverless -> the endpoint -> Builds: the image build from GitHub "
    "must show Completed. If it failed, open the build log and fix the Dockerfile; if there is no build, "
    "check that Max Workers is at least 1 and the GPU type is available in the volume's data center."
)


def health(c: httpx.Client) -> dict:
    return c.get(f"{base}/health", headers=headers).json()


with httpx.Client(timeout=60) as c:
    h = health(c)
    jobs, workers = h.get("jobs", {}), h.get("workers", {})
    waiting = jobs.get("inQueue", 0) + jobs.get("inProgress", 0)
    started = time.time()
    last = None

    if waiting:
        print(f"{waiting} job(s) already waiting or running on the endpoint; not submitting another. Following it...", flush=True)
        while True:
            time.sleep(30)
            h = health(c)
            jobs, workers = h.get("jobs", {}), h.get("workers", {})
            mins = (time.time() - started) / 60
            snap = (jobs.get("inQueue"), jobs.get("inProgress"), jobs.get("completed"), jobs.get("failed"), workers.get("initializing"), workers.get("running"))
            if snap != last:
                print(f"[{mins:5.1f} min] queued={snap[0]} running={snap[1]} completed={snap[2]} failed={snap[3]} workers starting={snap[4]} busy={snap[5]}", flush=True)
                last = snap
            if jobs.get("completed"):
                print("done: the warm-up finished; the weights are on the volume.", flush=True)
                break
            if jobs.get("failed"):
                print("failed: open RunPod -> the endpoint -> Logs for the error.", flush=True)
                sys.exit(1)
            if mins > 20 and not any(workers.get(k) for k in ("initializing", "running", "idle", "ready")):
                print(HINT, flush=True)
                started = time.time()  # remind again in 20 minutes
        sys.exit(0)

    for attempt in range(10):
        r = c.post(f"{base}/run", headers=headers, json={"input": {"task": "warmup"}})
        if r.status_code != 409:  # 409 = the endpoint is still applying a change; try again shortly
            break
        print("endpoint is busy applying a change; retrying in 30 s", flush=True)
        time.sleep(30)
    r.raise_for_status()
    job_id = r.json()["id"]
    print(f"warmup job {job_id} submitted; waiting for a worker to start and download the weights...", flush=True)
    while True:
        time.sleep(30)
        s = c.get(f"{base}/status/{job_id}", headers=headers).json()
        status = s.get("status")
        mins = (time.time() - started) / 60
        if status != last:
            print(f"[{mins:5.1f} min] {status}", flush=True)
            last = status
        if status == "COMPLETED":
            print("done:", s.get("output"), flush=True)
            break
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            print("failed:", s.get("error") or s, flush=True)
            sys.exit(1)
        if status == "IN_QUEUE" and mins > 20 and int(mins) % 20 == 0:
            print(HINT, flush=True)
        if mins > 180:
            print("still not finished after 3 hours; check the endpoint logs on RunPod", flush=True)
            sys.exit(2)
