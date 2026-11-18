'use strict'
// Without an Apple Developer ID the app is not signed, but a Mac with Apple
// silicon refuses to run code with no signature at all ("is damaged"). An
// ad-hoc signature ("-") is enough for it to run once the person has chosen
// Open Anyway. Runs on macOS only, before the .dmg and .zip are made.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
