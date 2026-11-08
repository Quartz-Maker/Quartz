// electron-builder afterPack hook (Linux only): wrap the executable so it always starts with --no-sandbox.
// Chromium checks the SUID sandbox helper before the main script runs, so the app's own
// appendSwitch('no-sandbox') (src/main/index.ts) is too late for AppImage/tar.gz, where chrome-sandbox is
// not root-owned (the .deb post-install fixes it, the wrapper is harmless there).
const { renameSync, writeFileSync, chmodSync } = require('fs')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  const name = context.packager.executableName
  const bin = join(context.appOutDir, name)
  renameSync(bin, bin + '.bin')
  writeFileSync(bin, `#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/${name}.bin" --no-sandbox "$@"\n`)
  chmodSync(bin, 0o755)
}
