#!/usr/bin/env bash
# Resume the CludeMem v4-1m QLoRA run (Gemma 4 E4B, 1.05M rows) from its last checkpoint in
# gs://clude-query-sol-data-cludemem/v4-1m (checkpoint-8000 of 8204 steps), finish the epoch,
# run the retrieval-canary checkpoint selection (WINNER / DONE) and sync everything back.
#
#   ./cludemem/training/gcp/resume-v4-1m.sh            # 8x L4 (g2-standard-96), same shape as the original run
#   GPUS=1 ./cludemem/training/gcp/resume-v4-1m.sh     # 1x L4 (g2-standard-8), grad-accum 32, ~2.5 h
#
# Needs gcloud logged in to clude-query-sol-data. The VM runs resume-v4-1m.startup.sh
# (their cloud/train_v3.py + canary_torch.py + select_checkpoint_torch.py, staged at
# gs://clude-query-sol-data-cludemem/code/v4-resume/cloud/), writes progress to
# gs://clude-query-sol-data-cludemem/v4-1m/RESUME_STATUS and resume-<vm>.log, and deletes itself.
set -euo pipefail
PROJECT="${GCP_PROJECT:-clude-query-sol-data}"
GPUS="${GPUS:-8}"
NAME="${NAME:-cludemem-v4-resume}"
IMAGE_FAMILY="${IMAGE_FAMILY:-common-cu129-ubuntu-2204-nvidia-580}"   # driver 580 -> torch 2.12.1+cu130
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ "$GPUS" -ge 8 ]]; then MT=g2-standard-96; ACC=8; else MT=g2-standard-8; ACC=1; fi
ZONES="${ZONES:-us-central1-a us-central1-b us-central1-c us-east4-a us-east4-b us-east4-c us-west1-a us-west1-b us-east1-b us-east1-c}"
for Z in $ZONES; do
  echo "[resume] trying $MT (${ACC}x L4) in $Z"
  if gcloud compute instances create "$NAME" --project "$PROJECT" --zone "$Z" \
      --machine-type "$MT" --accelerator "type=nvidia-l4,count=$ACC" \
      --maintenance-policy TERMINATE --no-restart-on-failure \
      --image-family "$IMAGE_FAMILY" --image-project deeplearning-platform-release \
      --boot-disk-size 300GB --boot-disk-type pd-balanced \
      --scopes cloud-platform --labels cludemem=v4-resume \
      --metadata install-nvidia-driver=True \
      --metadata-from-file startup-script="$HERE/resume-v4-1m.startup.sh"; then
    echo "[resume] VM $NAME running in $Z. Follow it with:"
    echo "  gsutil cat gs://clude-query-sol-data-cludemem/v4-1m/RESUME_STATUS"
    echo "  gcloud compute ssh $NAME --zone $Z -- tail -f /var/log/cludemem-resume.log"
    exit 0
  fi
done
echo "[resume] no zone had capacity for $MT; retry later or run with GPUS=1" >&2
exit 1
