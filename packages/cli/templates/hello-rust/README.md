# __DISPLAY_NAME__

A `component-v1` OXP extension written in Rust, targeting the
[WASI Preview 2](https://github.com/WebAssembly/WASI) component model
and the canonical `oxp:extension@0.1.0` world.

## Prerequisites

```sh
rustup target add wasm32-wasip2
```

## Build & pack

```sh
oxp pack
# → runs `scripts.build` from oxp.json (cargo build + copy)
# → writes dist/__SLUG__-0.0.1.oxp
```

If you want to skip the build hook (e.g. you've built manually):

```sh
oxp pack --no-build
```

## What does it do?

The `activate` lifecycle export logs a single line via the always-on
`oxp:host/log` interface. `deactivate` logs `"goodbye"`. That's the
whole extension — it's deliberately minimal so you can verify the
toolchain end-to-end before adding logic.

## Layout

```
oxp.json       OXP manifest (component-v1, pins oxp:extension@0.1.0)
Cargo.toml     Rust crate definition (cdylib)
src/lib.rs     Component implementation (lifecycle + ui-handler + command-handler)
wit/           WIT contract — extension.wit + deps/oxp-host/oxp-host.wit
build/         Built .wasm artefact — packed into the bundle
dist/          Output of `oxp pack` (.oxp + signature); gitignored
```

The `wit/` directory is shipped inline so the project builds without
any monorepo dependency. If the upstream `oxp:extension` world ever
changes you'll need to refresh the files and update `oxp.json#wit.sha256`
to match — `oxp create --template hello-rust` always emits the current
hash, so the easy fix is to scaffold a fresh project and copy the new
WIT files + sha across.
