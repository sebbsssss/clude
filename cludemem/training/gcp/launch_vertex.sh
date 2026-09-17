#!/usr/bin/env bash
# Train CludeMem-49M on Google Cloud as a Vertex AI custom job (one L4 GPU by default).
#
#   BUCKET=<gcs-bucket> ./cludemem/training/gcp/launch_vertex.sh            # fresh run
#   BUCKET=<gcs-bucket> RESUME=1 ./cludemem/training/gcp/launch_vertex.sh   # continue the same RUN_NAME
#
# Run from the repo root on a machine with gcloud + gsutil logged in to the
# project (same conventions as infra/gcp/deploy-*.sh: GCP_PROJECT / GCP_REGION).
#
# What it does
#   1. generates the shards + tokenizer locally if they are missing (seconds, $0)
#   2. uploads data + tokenizer to gs://$BUCKET/cludemem/{data,tokenizer-49m}
#   3. submits an autopackaged Vertex custom job: cludemem/training/ is shipped as
#      the training package, train_small.py is the entrypoint, the bucket is
#      fuse-mounted at /gcs/$BUCKET so checkpoints land in GCS as they are written
#      (complete HF dirs; RESUME=1 picks the latest up with --resume auto)
#
# Cost: g2-standard-8 + 1x L4 is ~$1/h in us-central1; the 3-epoch recipe is ~1-2 h.
# Afterwards:
#   gsutil -m cp -r gs://$BUCKET/cludemem/runs/$RUN_NAME/final ./cludemem/training/runs/$RUN_NAME/
#   python cludemem/training/eval_small.py --model cludemem/training/runs/$RUN_NAME/final --data cludemem/data/heldout.jsonl --per-task 100
#   ./cludemem/packaging/export_gguf.sh cludemem/training/runs/$RUN_NAME/final cludemem-49m
set -euo pipefail

PROJECT="${GCP_PROJECT:-clude-query-sol-data}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${BUCKET:?set BUCKET to a GCS bucket name in $PROJECT (no gs:// prefix)}"
RUN_NAME="${RUN_NAME:-cludemem-49m}"
PRESET="${PRESET:-49m}"
EPOCHS="${EPOCHS:-3}"
MACHINE="${MACHINE:-g2-standard-8}"
ACCEL="${ACCEL:-NVIDIA_L4}"
ACCEL_COUNT="${ACCEL_COUNT:-1}"
# Vertex prebuilt PyTorch GPU container; pip deps come from requirements-49m.txt.
IMAGE="${IMAGE:-us-docker.pkg.dev/vertex-ai/training/pytorch-gpu.2-4.py310:latest}"
EXTRA_ARGS="${EXTRA_ARGS:-}"   # e.g. "--gen-eval-per-task=20 --wandb-project=cludemem"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# 1. local artefacts (deterministic; regenerate rather than trust a stale copy)
[[ -f cludemem/data/train.jsonl ]]   || npx tsx cludemem/data-engine/generate.ts --count 3000 --balance --seed 0 --out train.jsonl
[[ -f cludemem/data/heldout.jsonl ]] || npx tsx cludemem/data-engine/generate.ts --count 80 --no-seeds --seed 1 --out heldout.jsonl
if [[ ! -f cludemem/training/tokenizer-49m/tokenizer.model ]]; then
  ( cd cludemem/training \
    && python3 collect_text.py --out ../data/tokenizer-extra.txt ../../clude-memories.json ../../test-memory-pack.json \
         ../../scripts/demo/seed-maya-data/*.json ../../docs/*.md ../../docs/*/*.md ../../README.md \
    && python3 tokenizer_49m.py --data ../data/train.jsonl --extra-text ../data/tokenizer-extra.txt --out ./tokenizer-49m --vocab 16384 )
fi

# 2. upload
GCS="gs://$BUCKET/cludemem"
gsutil -m cp cludemem/data/train.jsonl cludemem/data/heldout.jsonl "$GCS/data/"
gsutil -m rsync -r cludemem/training/tokenizer-49m "$GCS/tokenizer-49m"

# 3. submit
MOUNT="/gcs/$BUCKET/cludemem"
ARGS="--data=$MOUNT/data/train.jsonl,--eval-data=$MOUNT/data/heldout.jsonl,--tokenizer=$MOUNT/tokenizer-49m"
ARGS+=",--out=$MOUNT/runs/$RUN_NAME,--preset=$PRESET,--epochs=$EPOCHS,--save-every=100,--keep=3"
[[ "${RESUME:-0}" == "1" ]] && ARGS+=",--resume=auto"
for a in $EXTRA_ARGS; do ARGS+=",$a"; done
REQS="$(grep -vE '^\s*#|^\s*$' cludemem/training/requirements-49m.txt | grep -v '^torch' | tr '\n' ';' | sed 's/;$//')"

gcloud ai custom-jobs create \
  --project "$PROJECT" --region "$REGION" \
  --display-name "$RUN_NAME-$(date +%Y%m%d-%H%M)" \
  --worker-pool-spec="machine-type=$MACHINE,replica-count=1,accelerator-type=$ACCEL,accelerator-count=$ACCEL_COUNT,executor-image-uri=$IMAGE,local-package-path=cludemem/training,script=train_small.py,requirements=$REQS" \
  --args="$ARGS"

echo "Submitted. Follow it:  gcloud ai custom-jobs list --project $PROJECT --region $REGION --filter='displayName:$RUN_NAME'"
echo "Checkpoints + log.jsonl: $GCS/runs/$RUN_NAME/   (gsutil ls $GCS/runs/$RUN_NAME/)"
