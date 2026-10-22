SOURCE
=====
Vendored copy of @3d-dice/dice-box-threejs (MIT), including its public/ textures and sounds
as shipped by the upstream package.

- Upstream: https://github.com/3d-dice/dice-box-threejs
- npm: https://www.npmjs.com/package/@3d-dice/dice-box-threejs
- Version: 0.0.12
- License: see LICENSE in this directory

Do not replace this tree with a git submodule; keep a direct copy in-repo.

LOCAL PATCHES
=============
- DiceBox constructor accepts an Element as well as a selector (src/DiceBox.js and both dist
  bundles). The upstream `document.querySelector(selector)` only searches the main document, so
  it finds nothing when the panel is rendered in a pop-out window.
