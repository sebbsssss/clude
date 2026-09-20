#!/bin/bash
# CludeMem v4-1m release: turn the finished run in gs://$B/v4-1m into a Hugging Face release.
# Runs as a VM startup script (see release-v4-1m.sh). Steps, each reported to
# gs://$B/v4-1m/RELEASE_STATUS:
#
#   1. their own trainer, `train_v3.py --select-only --export-gguf`, over the synced run dir:
#      canaries any checkpoint that lacks a score, re-applies the selection rule (WINNER /
#      checkpoint_selection.json) and exports GGUF (q4_k_m, q8_0) from the winner. Nothing in
#      the recipe or the rule is changed; the same arguments as the training run are passed.
#   2. the external contradiction eval (DNLI / DECODE through RECONCILE) with the winner adapter,
#      `external/dnli/run.py --backend torch`, at the run's default sample sizes.
#   3. a release dir: adapter/, evals/, gguf/, README.md (build_model_card.py, every number read
#      from the artefacts above) -> gs://$B/v4-1m/release/
#   4. if the VM carries `hf-repo` (+ `hf-token`) metadata, push_to_hf.py uploads it.
#
# The VM deletes itself only when every step succeeded; otherwise it stays up with
# /var/log/cludemem-release.log (also copied to gs://$B/v4-1m/release-<vm>.log).
set -uo pipefail
B=clude-query-sol-data-cludemem; RUN=v4-1m; BASE=unsloth/gemma-4-E4B-it
LOG=/var/log/cludemem-release.log; exec > >(tee -a $LOG) 2>&1
MD="curl -s -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance"
ZONE=$($MD/zone | awk -F/ '{print $NF}'); NAME=$($MD/name)
attr() { curl -sf -H Metadata-Flavor:Google "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null; }
HF_REPO=$(attr hf-repo); HF_GGUF_REPO=$(attr hf-gguf-repo); HF_PRIVATE=$(attr hf-private)
ALLOW_SELECT=$(attr allow-select)   # "1": permit selection when the run has no WINNER yet (unfinished epoch)
GS="gcloud storage --verbosity=warning"
say() { echo "[$(date -u +%FT%TZ)] $*"; }
status() { say "$*"; echo "$(date -u +%FT%TZ) $*" | $GS cp - gs://$B/$RUN/RELEASE_STATUS 2>/dev/null; }
OK=0
finish() {
  status "exiting (code $1); final sync"
  timeout 300 $GS cp $LOG gs://$B/$RUN/release-$NAME.log || true
  if [ "$OK" = 1 ]; then gcloud compute instances delete "$NAME" --zone "$ZONE" --quiet || true; fi
}
STAGEF=/run/cludemem-stage; stage() { echo "$1" > "$STAGEF"; }; stage boot
heartbeat() {
  while true; do
    sleep 180
    echo "$(date -u +%FT%TZ) [$(cat "$STAGEF" 2>/dev/null)] alive; $(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader 2>/dev/null | head -1)" \
      | $GS cp - gs://$B/$RUN/RELEASE_STATUS 2>/dev/null
  done
}
heartbeat & HB=$!
trap 'rc=$?; kill $HB 2>/dev/null; finish $rc' EXIT

status "boot on $NAME ($ZONE): waiting for GPU driver"
for i in $(seq 1 90); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
nvidia-smi || { status "no GPU driver after 15 min"; exit 1; }
DRV=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | cut -d. -f1)

# ---- inputs -------------------------------------------------------------------------------
WINNER=$($GS cat gs://$B/$RUN/WINNER 2>/dev/null | awk '{print $1}')
if [ -z "$WINNER" ] && [ "$ALLOW_SELECT" != 1 ]; then
  status "no WINNER in gs://$B/$RUN: the run has not finished. Finish it (resume-v4-1m.sh) or set allow-select=1 to select among the saved checkpoints"; exit 2
fi
say "WINNER in bucket: ${WINNER:-none (allow-select=1)}"
mkdir -p /mnt/results/$RUN /mnt/results/evals /home/gcpuser/cludemem-train && cd /home/gcpuser/cludemem-train
stage fetch; status "fetching code, hf/ scripts, corpus, run dir, eval bundle"
timeout 600 $GS cp -r gs://$B/code/v4-resume/cloud . || { status "fetch cloud/ failed"; exit 1; }
timeout 600 $GS cp -r gs://$B/code/v4-release/hf . || { status "fetch hf/ failed"; exit 1; }
timeout 1800 $GS cp gs://$B/data/cludemem-data-1m.tgz /tmp/data.tgz || { status "corpus download failed"; exit 1; }
tar --warning=no-unknown-keyword -xzf /tmp/data.tgz && rm -f /tmp/data.tgz || { status "corpus extract failed"; exit 1; }
timeout 3600 $GS rsync -r --exclude '^(RESUME_|RELEASE_|resume-.*\.log|release-.*\.log|release/.*)' gs://$B/$RUN /mnt/results/$RUN \
  || { status "run-dir sync failed"; exit 1; }
timeout 600 $GS cp gs://$B/staging/eval-dnli.tgz /tmp/eval.tgz && mkdir -p eval && tar -xzf /tmp/eval.tgz -C eval \
  || { status "eval bundle fetch failed"; exit 1; }
say "run dir: $(du -sh /mnt/results/$RUN | cut -f1); checkpoints: $(ls -d /mnt/results/$RUN/checkpoint-* | wc -l)"

# ---- python env (same pins as the training run) --------------------------------------------
stage python-env; status "python env: torch 2.12.1 + unsloth 2026.9.4"
PY=""
for c in /opt/conda/bin/python python3.12 python3.11 python3.10 python3; do
  p=$(command -v "$c" 2>/dev/null) || continue
  "$p" -m pip --version >/dev/null 2>&1 || continue
  PY="$p"; break
done
if [ -z "$PY" ]; then
  export DEBIAN_FRONTEND=noninteractive
  timeout 300 apt-get update -qq || true; timeout 600 apt-get install -y -qq python3-pip || true
  PY=$(command -v python3)
  "$PY" -m pip --version >/dev/null 2>&1 || { timeout 300 curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && "$PY" /tmp/get-pip.py -q; }
fi
"$PY" -m pip --version || { status "could not obtain a python with pip"; exit 1; }
PIPX=""; "$PY" -m pip install -q -U pip 2>/dev/null || { PIPX="--break-system-packages"; "$PY" -m pip install -q -U pip $PIPX; }
# unsloth_zoo is pinned to the newest release that existed when the run started (2026-09-11):
# unsloth 2026.9.4 only says ">=2026.9.3", and the 2026.9.6 zoo that pip picked otherwise could
# not patch trl 0.24.0's SFTTrainer ("source anchor not found"), fell back to a double forward
# per step and then refused it under Gemma-4 KV sharing on transformers 5.5.0.
echo "torch==2.12.1" > /tmp/c.txt
CU=cu130; [ "${DRV:-0}" -lt 580 ] && CU=cu126
$PY -m pip install -q $PIPX torch==2.12.1 --index-url https://download.pytorch.org/whl/$CU \
    || $PY -m pip install -q $PIPX torch==2.12.1 || { status "torch install failed"; exit 1; }
$PY -m pip install -q $PIPX -U "jinja2>=3.1.2" "packaging>=23" "filelock>=3.12" "pyyaml>=6" "requests>=2.31" "typing_extensions>=4.10" \
    || { status "base-dependency upgrade failed"; exit 1; }
$PY -m pip install -q $PIPX -c /tmp/c.txt "unsloth==2026.9.4" "unsloth_zoo==2026.9.3" "transformers==5.5.0" "trl==0.24.0" "peft==0.20.0" \
    "datasets==4.3.0" "bitsandbytes==0.50.2" accelerate sentencepiece protobuf hf_transfer "huggingface_hub>=0.30" \
    scikit-learn || { status "pip install failed"; exit 1; }
$PY -c "import torch,unsloth,transformers,trl,peft,huggingface_hub; print('torch',torch.__version__,'cuda',torch.cuda.is_available())" \
    || { status "import check failed"; exit 1; }
export HF_HUB_ENABLE_HF_TRANSFER=1 TOKENIZERS_PARALLELISM=false

# ---- 1. selection + GGUF export with their trainer (same arguments as the run) --------------
stage select-export; status "train_v3.py --select-only --export-gguf over $RUN"
COMMON="cloud/train_v3.py --data data/train.jsonl data-hard-v2/train.jsonl data-scale/1m/reconcile_v2/reconcile.jsonl data-scale/1m/extract/all.jsonl data-scale/1m/consolidate/all.jsonl data-scale/1m/answer/all.jsonl --out /mnt/results/$RUN --lr 0.00028 --rank 16 --alpha 32 --dropout 0.05 --epochs 1 --batch 4 --max-seq 2816 --save-steps 500 --warmup-steps 100 --canary-per-task 6"
timeout 4h $PY $COMMON --select-only --export-gguf; RC=$?
WINNER=$(awk '{print $1}' /mnt/results/$RUN/WINNER 2>/dev/null)
say "select-only rc=$RC; WINNER=${WINNER:-none}"
if [ -z "$WINNER" ]; then status "selection produced no WINNER (rc=$RC)"; exit 3; fi
GGUF_OK=1; [ "$RC" -ne 0 ] && { GGUF_OK=0; say "GGUF export failed (rc=$RC); the adapter release continues without GGUF"; }
WDIR=/mnt/results/$RUN/$WINNER; [ "$WINNER" = final ] && WDIR=/mnt/results/$RUN
[ -f "$WDIR/adapter_model.safetensors" ] || { status "winner dir $WDIR has no adapter_model.safetensors"; exit 3; }
timeout 1800 $GS rsync -r --exclude '^(RESUME_|RELEASE_|resume-.*\.log|release-.*\.log|release/.*)' /mnt/results/$RUN gs://$B/$RUN || true

# ---- 2. external contradiction eval (DNLI / DECODE) ----------------------------------------
stage dnli-eval; status "DNLI/DECODE eval with $WINNER (dnli_gp:250 decode_gp:350, ~3 h on an L4)"
EVAL_OUT=/mnt/results/evals/dnli/${RUN}_torch; mkdir -p $EVAL_OUT
timeout 6h $PY eval/external/dnli/run.py --backend torch --model $BASE --adapter "$WDIR" \
    --sets dnli_gp:250 decode_gp:350 --results $EVAL_OUT 2>&1 | tee $EVAL_OUT/run.log
[ -f $EVAL_OUT/results_all.json ] || { status "DNLI eval produced no results_all.json"; exit 4; }
timeout 600 $GS cp -r /mnt/results/evals gs://$B/ || true

# ---- 3. release dir + model card -----------------------------------------------------------
stage release; status "assembling release dir + model card"
REL=/mnt/results/release; rm -rf $REL; mkdir -p $REL/adapter $REL/evals $REL/gguf
for f in "$WDIR"/*; do
  case "$(basename "$f")" in
    optimizer.pt|scheduler.pt|rng_state*|trainer_state.json|training_args.bin|scaler.pt|canary*.json|*.log) ;;
    *) [ -f "$f" ] && cp "$f" $REL/adapter/ ;;
  esac
done
for f in checkpoint_selection.json canary.jsonl canary_base_torch.json canary_base_torch.hard.json config.json WINNER TRAIN_STEP; do
  [ -f /mnt/results/$RUN/$f ] && cp /mnt/results/$RUN/$f $REL/evals/
done
[ -f "$WDIR/canary.json" ] && cp "$WDIR/canary.json" $REL/evals/canary_winner.json
[ -f "$WDIR/canary.hard.json" ] && cp "$WDIR/canary.hard.json" $REL/evals/canary_winner.hard.json
mkdir -p $REL/evals/dnli && cp $EVAL_OUT/*.json $EVAL_OUT/run.log $REL/evals/dnli/ 2>/dev/null
[ "$GGUF_OK" = 1 ] && find /mnt/results/$RUN/gguf -name '*.gguf' -exec cp {} $REL/gguf/ \; 2>/dev/null
ls $REL/gguf/*.gguf >/dev/null 2>&1 || rmdir $REL/gguf
BASE_LICENSE=$(curl -sf "https://huggingface.co/api/models/$BASE" | $PY -c "import sys,json; d=json.load(sys.stdin); print(d.get('cardData',{}).get('license') or '')" 2>/dev/null)
say "base model license on the Hub: ${BASE_LICENSE:-unknown}"
CARD_ARGS="--run-dir /mnt/results/$RUN --dnli $EVAL_OUT/results_all.json --repo ${HF_REPO:-clude/cludemem-e4b} --out $REL/README.md"
[ -n "$BASE_LICENSE" ] && CARD_ARGS="$CARD_ARGS --base-license $BASE_LICENSE"
[ -n "$HF_GGUF_REPO" ] && [ -d $REL/gguf ] && CARD_ARGS="$CARD_ARGS --gguf-repo $HF_GGUF_REPO"
$PY hf/build_model_card.py $CARD_ARGS || { status "model card build failed"; exit 5; }
say "release dir:"; du -sh $REL/*; find $REL -type f | sort
timeout 3600 $GS rsync -r --delete-unmatched-destination-objects $REL gs://$B/$RUN/release || { status "release upload to GCS failed"; exit 6; }
status "release in gs://$B/$RUN/release (winner $WINNER, gguf=$GGUF_OK)"

# ---- 4. Hugging Face upload (only when the VM was given a repo + token) ----------------------
if [ -n "$HF_REPO" ]; then
  stage hf-upload; status "uploading to https://huggingface.co/$HF_REPO"
  HF_TOKEN=$(attr hf-token)
  [ -n "$HF_TOKEN" ] || { status "hf-repo set but no hf-token metadata; release stays in GCS"; exit 7; }
  PUSH="hf/push_to_hf.py --release $REL --repo $HF_REPO"
  [ -n "$HF_GGUF_REPO" ] && PUSH="$PUSH --gguf-repo $HF_GGUF_REPO"
  [ "$HF_PRIVATE" = 1 ] && PUSH="$PUSH --private"
  HF_TOKEN="$HF_TOKEN" timeout 2h $PY $PUSH || { status "Hugging Face upload failed; release stays in GCS"; exit 7; }
  status "published: https://huggingface.co/$HF_REPO"
else
  say "no hf-repo metadata: skipping the Hugging Face upload (run push_to_hf.py on gs://$B/$RUN/release)"
fi
OK=1
status "done: winner $WINNER, release gs://$B/$RUN/release${HF_REPO:+, https://huggingface.co/$HF_REPO}"
exit 0
