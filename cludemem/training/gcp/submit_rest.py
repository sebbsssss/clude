#!/usr/bin/env python3
"""
Submit the CludeMem-49M Vertex AI job with nothing but an OAuth access token —
for machines without the gcloud CLI (e.g. a Claude Code container).

  # on any machine that is logged in to the project (token lives ~1 h):
  gcloud auth print-access-token
  # here:
  GCP_ACCESS_TOKEN=<paste> python cludemem/training/gcp/submit_rest.py --bucket <bucket>
  GCP_ACCESS_TOKEN=<paste> python cludemem/training/gcp/submit_rest.py --status <job resource name>

Same job as launch_vertex.sh: uploads data + tokenizer to gs://<bucket>/cludemem/,
then creates a custom job (1x L4 by default) whose container clones this branch
from GitHub, installs requirements-49m.txt and runs train_small.py with the bucket
fuse-mounted at /gcs/<bucket>, so checkpoints land in GCS as they are written.
Only curl is needed locally; the proxy CA bundle is honoured if present.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

CA = os.environ.get("CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE") or "/root/.ccr/ca-bundle.crt"


def token() -> str:
    t = os.environ.get("GCP_ACCESS_TOKEN") or os.environ.get("CLOUDSDK_AUTH_ACCESS_TOKEN")
    if not t:
        sys.exit("set GCP_ACCESS_TOKEN (gcloud auth print-access-token on a logged-in machine)")
    return t


def call(method: str, url: str, body: dict | None = None, file: str | None = None, ctype="application/json") -> dict:
    cmd = ["curl", "-sS", "-X", method, "-H", f"Authorization: Bearer {token()}", "-H", f"Content-Type: {ctype}", url]
    if os.path.exists(CA):
        cmd += ["--cacert", CA]
    if body is not None:
        cmd += ["--data-binary", json.dumps(body)]
    if file is not None:
        cmd += ["--data-binary", f"@{file}"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"curl failed: {out.stderr.strip()}")
    try:
        data = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        sys.exit(f"non-JSON response from {url}: {out.stdout[:400]}")
    if "error" in data:
        sys.exit(f"{method} {url} -> {json.dumps(data['error'])[:600]}")
    return data


def ensure_bucket(project: str, region: str, bucket: str) -> None:
    probe = subprocess.run(["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-H", f"Authorization: Bearer {token()}",
                            *(["--cacert", CA] if os.path.exists(CA) else []),
                            f"https://storage.googleapis.com/storage/v1/b/{bucket}"], capture_output=True, text=True).stdout
    if probe == "200":
        return
    if probe != "404":
        sys.exit(f"bucket probe returned HTTP {probe} (token scope / project?)")
    print(f"[gcp] creating bucket gs://{bucket} in {region}")
    call("POST", f"https://storage.googleapis.com/storage/v1/b?project={project}",
         {"name": bucket, "location": region.upper(), "storageClass": "STANDARD",
          "iamConfiguration": {"uniformBucketLevelAccess": {"enabled": True}}})


def upload(bucket: str, name: str, path: str) -> None:
    size = os.path.getsize(path)
    print(f"[gcp] upload {path} -> gs://{bucket}/{name} ({size / 1e6:.1f} MB)")
    call("POST", f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={name}",
         file=path, ctype="application/octet-stream")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=os.environ.get("GCP_PROJECT", "clude-query-sol-data"))
    ap.add_argument("--region", default=os.environ.get("GCP_REGION", "us-central1"))
    ap.add_argument("--bucket", help="GCS bucket (created if missing)")
    ap.add_argument("--run-name", default="cludemem-49m")
    ap.add_argument("--branch", default="claude/tender-keller-ypu3up")
    ap.add_argument("--repo", default="https://github.com/sebbsssss/clude")
    ap.add_argument("--preset", default="49m")
    ap.add_argument("--epochs", default="3")
    ap.add_argument("--machine", default="g2-standard-8")
    ap.add_argument("--accelerator", default="NVIDIA_L4")
    ap.add_argument("--accelerator-count", type=int, default=1)
    ap.add_argument("--image", default="us-docker.pkg.dev/vertex-ai/training/pytorch-gpu.2-4.py310:latest")
    ap.add_argument("--resume", action="store_true", help="continue the same run name with --resume auto")
    ap.add_argument("--extra-args", default="--gen-eval-per-task 20", help="appended to train_small.py")
    ap.add_argument("--skip-upload", action="store_true")
    ap.add_argument("--status", default=None, help="print the state of an existing job (resource name) and exit")
    args = ap.parse_args()

    api = f"https://{args.region}-aiplatform.googleapis.com/v1"
    if args.status:
        j = call("GET", f"{api}/{args.status}")
        print(json.dumps({k: j.get(k) for k in ("displayName", "state", "createTime", "startTime", "endTime", "error")}, indent=2))
        return
    if not args.bucket:
        ap.error("--bucket is required")

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    data = os.path.join(root, "cludemem", "data")
    tokdir = os.path.join(root, "cludemem", "training", "tokenizer-49m")
    for f in ("train.jsonl", "heldout.jsonl"):
        if not os.path.exists(os.path.join(data, f)):
            sys.exit(f"missing {data}/{f}: run the data engine first (see README 2b)")
    if not os.path.exists(os.path.join(tokdir, "tokenizer.model")):
        sys.exit(f"missing {tokdir}: run tokenizer_49m.py first")

    ensure_bucket(args.project, args.region, args.bucket)
    if not args.skip_upload:
        for f in ("train.jsonl", "heldout.jsonl"):
            upload(args.bucket, f"cludemem/data/{f}", os.path.join(data, f))
        for f in sorted(os.listdir(tokdir)):
            upload(args.bucket, f"cludemem/tokenizer-49m/{f}", os.path.join(tokdir, f))

    mount = f"/gcs/{args.bucket}/cludemem"
    train = (f"python train_small.py --data {mount}/data/train.jsonl --eval-data {mount}/data/heldout.jsonl "
             f"--tokenizer {mount}/tokenizer-49m --out {mount}/runs/{args.run_name} --preset {args.preset} "
             f"--epochs {args.epochs} --save-every 100 --keep 3 {args.extra_args}"
             + (" --resume auto" if args.resume else ""))
    script = (f"set -euo pipefail; nvidia-smi || true; git clone --depth 1 -b {args.branch} {args.repo} /w; "
              f"cd /w/cludemem/training; pip install -q -r requirements-49m.txt; {train}")
    body = {
        "displayName": f"{args.run_name}-{time.strftime('%Y%m%d-%H%M')}",
        "jobSpec": {
            "workerPoolSpecs": [{
                "machineSpec": {"machineType": args.machine, "acceleratorType": args.accelerator,
                                "acceleratorCount": args.accelerator_count},
                "replicaCount": "1",
                "diskSpec": {"bootDiskType": "pd-ssd", "bootDiskSizeGb": 100},
                "containerSpec": {"imageUri": args.image, "command": ["bash", "-lc"], "args": [script]},
            }],
            "scheduling": {"timeout": "21600s"},
        },
    }
    j = call("POST", f"{api}/projects/{args.project}/locations/{args.region}/customJobs", body)
    name = j["name"]
    print(f"[gcp] submitted {j['displayName']} -> {name}")
    print(f"[gcp] console: https://console.cloud.google.com/vertex-ai/locations/{args.region}/training/{name.rsplit('/', 1)[1]}/cpu?project={args.project}")
    print(f"[gcp] checkpoints: gs://{args.bucket}/cludemem/runs/{args.run_name}/   status: --status {name}")


if __name__ == "__main__":
    main()
