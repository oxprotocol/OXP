# oxp-jetbrains

JetBrains IDE host for [OXP](https://oxprotocol.org). Single plugin, runs in
**every** modern JetBrains IDE (IntelliJ IDEA, PyCharm, WebStorm, GoLand,
Rider, RustRover, CLion, DataGrip) on platform 251 (2025.1) and newer.

## Architecture

```
┌──────────────────────────┐    JSON-RPC 2.0    ┌─────────────────────┐
│  IntelliJ Platform JVM   │ ◀── stdio ───────▶ │  oxp-runtime (Rust) │
│  ─ OxpRuntimeService     │  Content-Length    │  ─ wasmtime         │
│  ─ Actions / UI          │     framing        │  ─ WASI sandbox     │
└──────────────────────────┘                    └─────────────────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────────┐
                                                │  extension.wasm     │
                                                │  (wasm-component)   │
                                                └─────────────────────┘
```

Subprocess model per [`spec/v1/host-runtime-rpc.md`](../../spec/v1/host-runtime-rpc.md) §4. The plugin
ships precompiled `oxp-runtime` binaries for all six release targets inside
the plugin .zip — zero-config UX.

## Build

```sh
cd hosts/jetbrains
./scripts/stage-runtime.sh         # builds runtime for the current platform
./gradlew runIde                   # launches a sandbox IDE
./gradlew buildPlugin              # produces build/distributions/oxp-jetbrains-*.zip
```

For a release build, CI runs `./scripts/stage-runtime.sh --all` to cross-compile
all six runtime targets, then `./gradlew buildPlugin verifyPlugin`.

## Layout

| Path | Purpose |
|---|---|
| [build.gradle.kts](build.gradle.kts) | Gradle + IntelliJ Platform Plugin 2.x. |
| [src/main/resources/META-INF/plugin.xml](src/main/resources/META-INF/plugin.xml) | Plugin descriptor. Depends on `com.intellij.modules.platform` only. |
| [src/main/kotlin/dev/oxp/jetbrains/protocol](src/main/kotlin/dev/oxp/jetbrains/protocol) | JSON-RPC framing, transport, types. |
| [src/main/kotlin/dev/oxp/jetbrains/runtime/OxpRuntimeService.kt](src/main/kotlin/dev/oxp/jetbrains/runtime/OxpRuntimeService.kt) | Application service: spawns subprocess, owns RPC client. |
| [src/main/kotlin/dev/oxp/jetbrains/runtime/OxpRuntimeBinary.kt](src/main/kotlin/dev/oxp/jetbrains/runtime/OxpRuntimeBinary.kt) | Locates the per-platform binary inside the plugin. |
| [src/main/kotlin/dev/oxp/jetbrains/host/HostCapabilities.kt](src/main/kotlin/dev/oxp/jetbrains/host/HostCapabilities.kt) | Capability descriptor sent in `initialize`. |
| [src/main/kotlin/dev/oxp/jetbrains/actions](src/main/kotlin/dev/oxp/jetbrains/actions) | Tools → OXP menu actions. |
| [scripts/stage-runtime.sh](scripts/stage-runtime.sh) | Build + stage runtime binaries. |

## Status

Protocol-validation cut. End-to-end load + activate + command + deactivate +
unload works. UI surface bridges (status bar widget, tool window, completions,
diagnostics) and host capability callbacks (fs / net / secrets / commands)
are next milestones.

Android Studio is intentionally out-of-scope at launch — Google's fork lags
the IntelliJ Platform by ~2 releases. A 241-baseline compatibility build
will follow once the protocol stabilises.
