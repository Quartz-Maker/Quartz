#!/usr/bin/env bash
# Uninstall the Quartz .deb.
set -euo pipefail

if ! dpkg -s quartz >/dev/null 2>&1; then
  echo "Quartz is not installed."
  exit 0
fi

echo "Removing Quartz..."
if command -v apt >/dev/null 2>&1; then
  sudo apt remove -y quartz
else
  sudo dpkg -r quartz
fi

echo "Done. (Per-vault .quartz/ config and the global registry in"
echo " ~/.config/quartz are left untouched.)"
