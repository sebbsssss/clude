#!/usr/bin/env bash
# Launch the CludeMem v4-1m release VM (1x L4): selection + GGUF export with the run's own
# trainer, the DNLI/DECODE eval, the model card, and the upload to GCS (+ Hugging Face).
# See release-v4-1m.startup.sh for what the VM does.
#
#   HF_TOKEN=hf_... HF_REPO=clude/cludemem-e4b [HF_GGUF_REPO=clude/cludemem-e4b-GGUF] \
#       ./cludemem/packaging/hf/release-v4-1m.sh
#   ./cludemem/packaging/hf/release-v4-1m.sh          # no HF vars: release lands in GCS only
#
# Follow it with:
#   gsutil cat gs://clude-query-sol-data-cludemem/v4-1m/RELEASE_STATUS
#
# The HF token travels as instance metadata (readable by anyone with compute.instances.get on
# the project) and dies with the VM; use a fine-grained write token scoped to the target repos.
set -euo pipefail
PROJECT="${GCP_PROJECT:-clude-query-sol-data}"
B=clude-query-sol-data-cludemem
NAME="${NAME:-cludemem-v4-release}"
IMAGE_FAMILY="${IMAGE_FAMILY:-common-cu129-ubuntu-2204-nvidia-580}"
ZONES="${ZONES:-us-central1-a us-central1-b us-central1-c us-east4-a us-east4-b us-east4-c us-west1-a us-west1-b us-east1-b us-east1-c}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ -n "${HF_REPO:-}" && -z "${HF_TOKEN:-}" ]]; then echo "HF_REPO set but HF_TOKEN empty" >&2; exit 1; fi
if [[ -z "${ALLOW_SELECT:-}" ]] && ! gcloud storage cat "gs://$B/v4-1m/WINNER" >/dev/null 2>&1; then
  echo "gs://$B/v4-1m/WINNER does not exist: the run has not finished. Finish it first (resume-v4-1m.sh)," >&2
  echo "or ALLOW_SELECT=1 to select among the checkpoints saved so far (that is a change to the plan)." >&2
  exit 1
fi

echo "[release] staging hf/ scripts to gs://$B/code/v4-release/hf/"
gcloud storage cp "$HERE"/build_model_card.py "$HERE"/push_to_hf.py "gs://$B/code/v4-release/hf/"

META="hf-repo=${HF_REPO:-},hf-gguf-repo=${HF_GGUF_REPO:-},hf-private=${HF_PRIVATE:-0},allow-select=${ALLOW_SELECT:-0}"
[[ -n "${HF_TOKEN:-}" ]] && META="$META,hf-token=$HF_TOKEN"
for Z in $ZONES; do
  echo "[release] trying g2-standard-8 (1x L4) in $Z"
  if gcloud compute instances create "$NAME" --project "$PROJECT" --zone "$Z" \
      --machine-type g2-standard-8 --accelerator "type=nvidia-l4,count=1" \
      --maintenance-policy TERMINATE --no-restart-on-failure \
      --image-family "$IMAGE_FAMILY" --image-project deeplearning-platform-release \
      --boot-disk-size 300GB --boot-disk-type pd-balanced \
      --scopes cloud-platform --labels cludemem=v4-release \
      --metadata "$META" \
      --metadata-from-file startup-script="$HERE/release-v4-1m.startup.sh"; then
    echo "[release] VM $NAME running in $Z. Follow it with:"
    echo "  gsutil cat gs://$B/v4-1m/RELEASE_STATUS"
    echo "  gcloud compute ssh $NAME --zone $Z -- tail -f /var/log/cludemem-release.log"
    exit 0
  fi
done
echo "[release] no zone had capacity for a g2-standard-8; retry later" >&2
exit 1
