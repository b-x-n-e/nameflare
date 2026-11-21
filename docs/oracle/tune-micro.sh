#!/usr/bin/env bash
# tune-micro.sh: fit an Oracle Always Free VM.Standard.E2.1.Micro to Nameflare.
# The shape is 1/8 OCPU (2 threads), 1 GB RAM, no swap. Run as the ubuntu user;
# it is idempotent, so running it again changes nothing that is already set.
#
#   1. A 1 GB swap file with low swappiness: a memory spike (an image upload,
#      apt, certbot) slows down instead of waking the OOM killer.
#   2. The journal is capped at 64 MB (it had grown to 280 MB).
#   3. Daemons a headless VM never uses are stopped: fwupd (firmware updates,
#      ~145 MB resident), udisks2 (desktop disk manager) and rpcbind (NFS
#      portmapper). snapd stays: the Oracle Cloud Agent is a snap.
#   4. Old releases are pruned to the live one, the previous one and the
#      newest other two.
set -euo pipefail

if ! swapon --show | grep -q .; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 1G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
  fi
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' | sudo tee /etc/sysctl.d/90-nameflare.conf >/dev/null
sudo sysctl -q --system

sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=64M\nRuntimeMaxUse=16M\nMaxRetentionSec=1month\n' | sudo tee /etc/systemd/journald.conf.d/90-nameflare.conf >/dev/null
sudo systemctl restart systemd-journald
sudo journalctl --vacuum-size=64M >/dev/null 2>&1 || true

sudo systemctl stop fwupd.service fwupd-refresh.timer 2>/dev/null || true
sudo systemctl mask fwupd.service fwupd-refresh.timer fwupd-refresh.service >/dev/null 2>&1 || true
sudo systemctl disable --now udisks2.service rpcbind.service rpcbind.socket >/dev/null 2>&1 || true

RELEASES=/home/ubuntu/nameflare-releases
LIVE=$(readlink -f /home/ubuntu/nameflare || true)
PREVIOUS=$(cat "$RELEASES/previous-release.txt" 2>/dev/null || true)
ls -1dt "$RELEASES"/release-* 2>/dev/null | while read -r dir; do
  case "$dir" in "$LIVE"|"$PREVIOUS") continue ;; esac
  echo "$dir"
done | tail -n +3 | xargs -r rm -rf

echo "swap: $(swapon --show --noheadings | awk '{print $3}')  journal: $(journalctl --disk-usage | grep -o '[0-9.]*[KMG]')  releases: $(ls -1d "$RELEASES"/release-* | wc -l)"
free -m | awk 'NR==2{print "memory available: "$7" MB"}'
