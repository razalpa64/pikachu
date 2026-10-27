js-dos — the DOS emulator frontend — is vendored in this directory.

  version   8.5.3
  package   https://www.npmjs.com/package/js-dos   (npm pack js-dos@8.5.3)
  source    https://github.com/caiiiycuk/js-dos
  licence   GPL-2.0 (declared in the package's own package.json)
  license   https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

Nothing here has been modified. Files are copied verbatim from the npm tarball:

  js-dos.js           the player frontend (installs `window.Dos`)
  js-dos.css          its stylesheet
  emulators/emulators.js   the emulator loader and the file manifest it reads
  emulators/wdosbox.js     DOSBox (asm.js glue)
  emulators/wdosbox.wasm   DOSBox (WebAssembly core)
  emulators/wlibzip.js     ZIP reader used to mount a .jsdos bundle
  emulators/wlibzip.wasm

Not vendored, and not needed for the DOS shelf: the DOSBox-X cores (7–8 MB each),
the WebRTC/IPX networking shim, the sockdrive transport and the in-browser file
explorer. js-dos fetches those only when a feature asks for them by name, and this
player asks for the DOSBox core with `backend: "dosbox"`.

Why self-hosted rather than the CDN: the same reason EmulatorJS is self-hosted in
`/retro/data/`. A ~2 MB download should come from the site the reader is already
on, should be cacheable with the rest of the bundle, and should not turn a game
shelf into a dependency on somebody else's origin being up. It also means the
player can be tested against a known version instead of whatever `/latest` is
serving.

Upgrading: `npm pack js-dos@<version>`, replace the seven files above, run
`npm run dos:shelf`, and check `/retro/dos/pikachu-calibration` in a browser. The
file manifest inside `emulators/emulators.js` pins the core's own sizes, so a
mismatched set of files is the first thing to suspect if a bundle stops booting.
