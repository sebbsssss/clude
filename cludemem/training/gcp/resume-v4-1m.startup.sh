#!/bin/bash
# CludeMem v4-1m resume: continue from the latest checkpoint in gs://$B/v4-1m, finish the
# epoch (8204 steps), run canary-based checkpoint selection (WINNER/DONE), sync back, self-delete.
# Runs as the VM startup script (see resume-v4-1m.sh).
#
# Storage is driven with `gcloud storage`, never `gsutil -m`: the latter can deadlock in its
# multiprocessing pool and then hangs forever with no output (observed on this run, stuck in
# the fetch stage for 8 h). Every transfer also gets a `timeout`, so a stall fails loudly.
set -uo pipefail
B=clude-query-sol-data-cludemem; RUN=v4-1m
LOG=/var/log/cludemem-resume.log; exec > >(tee -a $LOG) 2>&1
MD="curl -s -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance"
ZONE=$($MD/zone | awk -F/ '{print $NF}'); NAME=$($MD/name)
GS="gcloud storage --verbosity=warning"
say() { echo "[$(date -u +%FT%TZ)] $*"; }
status() { say "$*"; echo "$(date -u +%FT%TZ) $*" | $GS cp - gs://$B/$RUN/RESUME_STATUS 2>/dev/null; }
sync_out() {
  timeout 3600 $GS rsync -r --exclude '^(RESUME_|resume-.*\.log)' /mnt/results/$RUN gs://$B/$RUN || true
  timeout 300 $GS cp $LOG gs://$B/$RUN/resume-$NAME.log || true
}
TRAINED=0
finish() {
  status "exiting (code $1); final sync"; sync_out
  $GS rm gs://$B/$RUN/RESUME_LOCK 2>/dev/null || true
  # Only self-delete after the trainer actually ran; any earlier exit (reboot, setup
  # failure) leaves the VM up so the log can be inspected.
  if [ "$TRAINED" = 1 ]; then gcloud compute instances delete "$NAME" --zone "$ZONE" --quiet || true; fi
}
LOCK_OWNER=$($GS cat gs://$B/$RUN/RESUME_LOCK 2>/dev/null | awk '{print $1}')
if [ -n "$LOCK_OWNER" ] && [ "$LOCK_OWNER" != "$NAME" ]; then echo "another resume ($LOCK_OWNER) holds the lock; exiting"; exit 0; fi
echo "$NAME $(date -u +%FT%TZ)" | $GS cp - gs://$B/$RUN/RESUME_LOCK

# Heartbeat: a silent stage is indistinguishable from a hung one, so report progress
# (stage + bytes on disk) every 3 minutes for as long as the script lives.
STAGE=boot
heartbeat() {
  while true; do
    sleep 180
    local sz; sz=$(du -sh /mnt/results/$RUN 2>/dev/null | cut -f1)
    echo "$(date -u +%FT%TZ) [$STAGE] alive; run dir $sz" | $GS cp - gs://$B/$RUN/RESUME_STATUS 2>/dev/null
  done
}
heartbeat & HB=$!
# rc must be captured BEFORE kill, which would otherwise overwrite $? with its own status
# (that is why a failed run reported "exiting (code 0)").
trap 'rc=$?; kill $HB 2>/dev/null; finish $rc' EXIT

status "boot on $NAME ($ZONE): waiting for GPU driver"
for i in $(seq 1 90); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
nvidia-smi || { status "no GPU driver after 15 min"; exit 1; }
NG=$(nvidia-smi -L | wc -l); DRV=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | cut -d. -f1)
status "$NG GPU(s), driver $DRV"

mkdir -p /mnt/results/$RUN /home/gcpuser/cludemem-train && cd /home/gcpuser/cludemem-train
STAGE=fetch-code; status "fetching cloud/ scripts"
timeout 600 $GS cp -r gs://$B/code/v4-resume/cloud . || { status "fetch cloud/ failed or timed out"; exit 1; }
STAGE=fetch-data; status "fetching the 1M corpus (218 MB)"
if [ ! -d data-scale ]; then
  timeout 1800 $GS cp gs://$B/data/cludemem-data-1m.tgz /tmp/data.tgz || { status "corpus download failed or timed out"; exit 1; }
  tar --warning=no-unknown-keyword -xzf /tmp/data.tgz && rm -f /tmp/data.tgz || { status "corpus extract failed"; exit 1; }
fi
STAGE=fetch-run; status "fetching the run dir (~3 GB of checkpoints)"
timeout 3600 $GS rsync -r --exclude '^(RESUME_|resume-.*\.log)' gs://$B/$RUN /mnt/results/$RUN \
  || { status "run-dir sync failed or timed out"; exit 1; }
say "run dir now: $(du -sh /mnt/results/$RUN | cut -f1); latest checkpoints:"
ls -d /mnt/results/$RUN/checkpoint-* 2>/dev/null | sort -t- -k2 -n | tail -3

STAGE=python-env; status "python env: torch 2.12.1 + unsloth 2026.9.4 (the original run's pins)"
# Install straight into the image's interpreter. An earlier version built a venv at /opt/cm;
# creation failed silently and every later `pip` was "command not found", so the venv is gone.
PY=/opt/conda/bin/python; [ -x "$PY" ] || PY=$(command -v python3)
[ -n "$PY" ] || { status "no python interpreter found"; exit 1; }
say "interpreter: $PY ($($PY --version 2>&1))"
$PY -m pip --version || $PY -m ensurepip --upgrade || { status "pip unavailable in $PY"; exit 1; }
$PY -m pip install -q -U pip
echo "torch==2.12.1" > /tmp/c.txt
CU=cu130; [ "${DRV:-0}" -lt 580 ] && CU=cu126
$PY -m pip install -q torch==2.12.1 --index-url https://download.pytorch.org/whl/$CU \
    || $PY -m pip install -q torch==2.12.1 || { status "torch install failed"; exit 1; }
$PY -m pip install -q -c /tmp/c.txt "unsloth==2026.9.4" "transformers==5.5.0" "trl==0.24.0" "peft==0.20.0" \
    "datasets==4.3.0" "bitsandbytes==0.50.2" accelerate sentencepiece protobuf hf_transfer \
    || { status "pip install failed"; exit 1; }
$PY -c "import torch,unsloth,transformers,trl,peft; print('torch',torch.__version__,'cuda',torch.cuda.is_available(),'n',torch.cuda.device_count(),'tf',transformers.__version__)" \
    || { status "torch/unsloth import failed"; exit 1; }
export HF_HUB_ENABLE_HF_TRANSFER=1 TOKENIZERS_PARALLELISM=false

( while true; do sleep 600; sync_out; done ) & SYNC=$!
COMMON="cloud/train_v3.py --data data/train.jsonl data-hard-v2/train.jsonl data-scale/1m/reconcile_v2/reconcile.jsonl data-scale/1m/extract/all.jsonl data-scale/1m/consolidate/all.jsonl data-scale/1m/answer/all.jsonl --out /mnt/results/$RUN --lr 0.00028 --rank 16 --alpha 32 --dropout 0.05 --epochs 1 --batch 4 --max-seq 2816 --save-steps 500 --warmup-steps 100 --canary-per-task 6 --resume"
TRAINED=1
STAGE=train
# `$PY -m torch.distributed.run` rather than the torchrun script, so the launcher is
# guaranteed to be the interpreter the packages were installed into.
if [ "$NG" -ge 8 ]; then
  status "training: 8 GPUs, grad-accum 4 (128 seq/step, same as the original run)"
  $PY -m torch.distributed.run --nproc_per_node 8 $COMMON --grad-accum 4; RC=$?
else
  ACC=$((32 / NG)); status "training: $NG GPU(s), grad-accum $ACC (128 seq/step)"
  if [ "$NG" -gt 1 ]; then $PY -m torch.distributed.run --nproc_per_node $NG $COMMON --grad-accum $ACC
  else $PY $COMMON --grad-accum $ACC; fi; RC=$?
fi
kill $SYNC 2>/dev/null
status "trainer exited rc=$RC; WINNER: $(cat /mnt/results/$RUN/WINNER 2>/dev/null || echo none)"
exit $RC
