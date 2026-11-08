#!/usr/bin/env bash
# Install the Quartz .deb (prod testing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEB="$(ls -t "$SCRIPT_DIR"/dist/quartz_*_amd64.deb 2>/dev/null | head -n1 || true)"

if [[ -z "$DEB" ]]; then
  echo "No .deb found in $SCRIPT_DIR/dist. Run: pnpm build:linux" >&2
  exit 1
fi

echo "Installing: $DEB"
# apt resolves dependencies; falls back to dpkg + fix if apt is unavailable.
if command -v apt >/dev/null 2>&1; then
  sudo apt install -y "$DEB"
else
  sudo dpkg -i "$DEB" || sudo apt-get -f install -y
fi

echo
echo "Installed. Launch from your app menu or run: /opt/Quartz/quartz"
echo "If it fails to start with a sandbox error on this machine, run once:"
echo "  echo 0 | sudo tee /proc/sys/kernel/apparmor_restrict_unprivileged_userns"
