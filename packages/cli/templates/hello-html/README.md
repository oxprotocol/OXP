# __DISPLAY_NAME__

A React + TypeScript OXP extension scaffolded by `oxp create`.

## Layout

```
src/
  App.tsx         ← edit me
  main.tsx        ← React entry, mounts <App /> on #root
  styles.css      ← global styles, inlined into the bundle
build.mjs         ← esbuild driver, emits a single inlined ui/index.html
ui/index.html     ← (generated, git-ignored)
oxp.json          ← extension manifest
.oxpignore        ← excludes src/, build.mjs, etc. from the .oxp
```

## Why a single inlined HTML?

OXP's `ui-v1` policy forbids loose `.js` and `.css` files in a bundle —
only HTML may execute. `build.mjs` runs esbuild with `format: "iife"` and
inlines both the JS and CSS into one self-contained `ui/index.html`. That
HTML is the only artefact that ships in the `.oxp`.

## Develop

```sh
npm install            # one-time
oxp dev                # watches files, rebuilds, serves to your IDE host
```

`oxp dev` runs `scripts.build` from `oxp.json` (`npm run build`, which
executes `node build.mjs`) before each repack.

## Ship

```sh
oxp pack               # produces dist/__SLUG__-<version>.oxp + .sig.json
oxp publish            # uploads to https://oxp.sh
```
