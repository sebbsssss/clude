#!/bin/bash
# CludeMem v4-1m resume: continue from the latest checkpoint in gs://$B/v4-1m, finish the
# epoch (8204 steps), run canary-based checkpoint selection (WINNER/DONE), sync back, self-delete.
# Runs as the VM startup script (see resume-v4-1m.sh).
set -uo pipefail
B=clude-query-sol-data-cludemem; RUN=v4-1m
LOG=/var/log/cludemem-resume.log; exec > >(tee -a $LOG) 2>&1
MD="curl -s -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance"
ZONE=$($MD/zone | awk -F/ '{print $NF}'); NAME=$($MD/name)
status() { echo "[$(date -u +%FT%TZ)] $*"; echo "$(date -u +%FT%TZ) $*" | gsutil -q cp - gs://$B/$RUN/RESUME_STATUS; }
sync_out() { gsutil -m -q rsync -r /mnt/results/$RUN gs://$B/$RUN || true; gsutil -q cp $LOG gs://$B/$RUN/resume-$NAME.log || true; }
TRAINED=0
finish() {
  status "exiting (code $1); final sync"; sync_out
  gsutil -q rm gs://$B/$RUN/RESUME_LOCK || true
  # Only self-delete after the trainer actually ran; any earlier exit (reboot, setup
  # failure) leaves the VM up so the log can be inspected with gcloud compute ssh.
  if [ "$TRAINED" = 1 ]; then gcloud compute instances delete "$NAME" --zone "$ZONE" --quiet || true; fi
}
LOCK_OWNER=$(gsutil -q cat gs://$B/$RUN/RESUME_LOCK 2>/dev/null | awk '{print $1}')
if [ -n "$LOCK_OWNER" ] && [ "$LOCK_OWNER" != "$NAME" ]; then echo "another resume ($LOCK_OWNER) holds the lock; exiting"; exit 0; fi
echo "$NAME $(date -u +%FT%TZ)" | gsutil -q cp - gs://$B/$RUN/RESUME_LOCK
trap 'finish $?' EXIT
status "boot on $NAME ($ZONE): waiting for GPU driver"
for i in $(seq 1 90); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
nvidia-smi || { status "no GPU driver after 15 min"; exit 1; }
NG=$(nvidia-smi -L | wc -l); DRV=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | cut -d. -f1)
status "$NG GPU(s), driver $DRV"
mkdir -p /mnt/results/$RUN /home/gcpuser/cludemem-train && cd /home/gcpuser/cludemem-train   # rsync needs the dest dir to exist
status "fetching code, data (1M corpus) and run dir"
gsutil -m -q cp -r gs://$B/code/v4-resume/cloud . || exit 1
gsutil -q cp gs://$B/data/cludemem-data-1m.tgz /tmp/data.tgz && tar --warning=no-unknown-keyword -xzf /tmp/data.tgz && rm /tmp/data.tgz || exit 1
gsutil -m -q rsync -r gs://$B/$RUN /mnt/results/$RUN || exit 1
ls /mnt/results/$RUN | tail -5
status "python env: torch 2.12.1 + unsloth 2026.9.4 (the original run's pins)"
PY=/opt/conda/bin/python; [ -x $PY ] || PY=python3
[ -d /opt/cm ] || $PY -m venv /opt/cm; . /opt/cm/bin/activate && pip install -q -U pip
echo "torch==2.12.1" > /tmp/c.txt
CU=cu130; [ "${DRV:-0}" -lt 580 ] && CU=cu126
pip install -q torch==2.12.1 --index-url https://download.pytorch.org/whl/$CU || pip install -q torch==2.12.1
pip install -q -c /tmp/c.txt "unsloth==2026.9.4" "transformers==5.5.0" "trl==0.24.0" "peft==0.20.0" "datasets==4.3.0" "bitsandbytes==0.50.2" accelerate sentencepiece protobuf hf_transfer || { status "pip install failed"; exit 1; }
python -c "import torch,unsloth,transformers,trl,peft; print('torch',torch.__version__,'cuda',torch.cuda.is_available(),'n',torch.cuda.device_count(),'tf',transformers.__version__)" || { status "torch/unsloth import failed"; exit 1; }
export HF_HUB_ENABLE_HF_TRANSFER=1 TOKENIZERS_PARALLELISM=false
( while true; do sleep 600; gsutil -m -q rsync -r /mnt/results/$RUN gs://$B/$RUN; gsutil -q cp $LOG gs://$B/$RUN/resume-$NAME.log; done ) &
SYNC=$!
COMMON="cloud/train_v3.py --data data/train.jsonl data-hard-v2/train.jsonl data-scale/1m/reconcile_v2/reconcile.jsonl data-scale/1m/extract/all.jsonl data-scale/1m/consolidate/all.jsonl data-scale/1m/answer/all.jsonl --out /mnt/results/$RUN --lr 0.00028 --rank 16 --alpha 32 --dropout 0.05 --epochs 1 --batch 4 --max-seq 2816 --save-steps 500 --warmup-steps 100 --canary-per-task 6 --resume"
TRAINED=1
if [ "$NG" -ge 8 ]; then
  status "training: torchrun x8, grad-accum 4 (128 seq/step, same as the original run)"
  torchrun --nproc_per_node 8 $COMMON --grad-accum 4; RC=$?
else
  ACC=$((32 / NG)); status "training: $NG GPU(s), grad-accum $ACC (128 seq/step)"
  if [ "$NG" -gt 1 ]; then torchrun --nproc_per_node $NG $COMMON --grad-accum $ACC; else python $COMMON --grad-accum $ACC; fi; RC=$?
fi
status "trainer exited rc=$RC; WINNER: $(cat /mnt/results/$RUN/WINNER 2>/dev/null || echo none)"
kill $SYNC 2>/dev/null
exit $RC
