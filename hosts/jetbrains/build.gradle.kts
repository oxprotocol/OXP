import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("java")
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
    // IntelliJ Platform Gradle Plugin 2.x — replaces the legacy `org.jetbrains.intellij`.
    id("org.jetbrains.intellij.platform") version "2.2.1"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
    jvmToolchain(providers.gradleProperty("javaVersion").get().toInt())
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity(providers.gradleProperty("platformVersion"))
        // No language-specific bundled plugins. We depend only on the
        // generic platform module so the same artifact installs into
        // IDEA / PyCharm / WebStorm / GoLand / Rider / RustRover / CLion / DataGrip.
        testFramework(TestFrameworkType.Platform)
    }

    // kotlinx-coroutines and kotlin-stdlib are provided by the IDE at runtime.
    // Bundling our own would break with NoSuchMethodError on coroutine intrinsics.
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")

    // kotlinx-serialization-json is bundled inside recent platforms but the
    // exposed coordinates are unstable across releases; we ship our own.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3") {
        exclude(group = "org.jetbrains.kotlin")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core")
    }

    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
    // The IntelliJ Platform test framework injects a JUnit 5 session listener
    // that touches `junit.framework.TestCase` (legacy JUnit 3 surface). Without
    // junit:junit on the classpath, even pure JUnit Jupiter tests fail to start.
    testRuntimeOnly("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.10.3")
}

intellijPlatform {
    pluginConfiguration {
        id = "dev.oxp.jetbrains"
        name = "OXP - Open Extension Protocol"
        version = providers.gradleProperty("pluginVersion")

        description = """
            <p>
              <b>Run universal OXP extensions (<code>.oxp</code> bundles) inside any JetBrains IDE.</b>
              One extension binary, every editor — write it once, ship it to IntelliJ IDEA, PyCharm,
              WebStorm, GoLand, Rider, RustRover, CLion, DataGrip,
              <em>and</em> VS Code and Neovim simultaneously.
            </p>

            <h2>What is OXP?</h2>
            <p>
              <a href="https://oxp.sh">OXP (Open Extension Protocol)</a> is an open spec
              for editor extensions distributed as sandboxed <b>WebAssembly components</b>
              (WASI Preview 2). The same <code>.oxp</code> bundle runs unchanged in every
              OXP-compatible host — no recompilation, no platform-specific code.
            </p>

            <table>
              <thead><tr><th>Host</th><th>Status</th><th>Where</th></tr></thead>
              <tbody>
                <tr><td><b>JetBrains</b> (all IDEs)</td><td>✅ Stable</td><td>This plugin</td></tr>
                <tr><td>VS Code &amp; forks</td><td>✅ Stable</td><td>oxprotocol.oxp-vscode</td></tr>
                <tr><td>Neovim</td><td>🔵 Beta</td><td><a href="https://github.com/oxprotocol/oxp">github.com/oxprotocol/oxp</a></td></tr>
              </tbody>
            </table>

            <h2>Features</h2>
            <ul>
              <li>
                <b>OXP Lens — Switchboard</b><br/>
                A management panel listing all installed extensions with toggle switches.
                Toggle ON → the extension gets its own native JetBrains tool window in the sidebar.
                Toggle OFF → it disappears instantly. Pin what you need, hide what you don't.
              </li>
              <li>
                <b>Native tool windows per extension</b><br/>
                Each enabled extension registers as an independent LEFT-anchor tool window —
                same level as Project, Structure, and Git views. Pop it out as a floating
                window with the ↗ button for full-screen use.
              </li>
              <li>
                <b>JCEF-powered rendering with OXP bridge</b><br/>
                Extensions render their HTML + React UIs in embedded Chromium (JCEF).
                The full OXP bridge is injected automatically: <code>oxp.fs</code>,
                <code>oxp.shell</code>, <code>oxp.net</code>, <code>oxp.secrets</code>
                — all sandboxed behind capability-based permission checks.
              </li>
              <li>
                <b>Automatic theme bridge</b><br/>
                IntelliJ's active color scheme is mapped to ~150 VS Code CSS custom properties
                on every page load. Extensions look native in any IDE theme, light or dark,
                without any extra configuration.
              </li>
              <li>
                <b>Shared install store</b><br/>
                Extensions live in <code>~/.oxp/host-store/extensions/</code>.
                Run <code>oxp install @publisher/slug</code> once and the extension immediately
                appears in every open IDE — JetBrains, VS Code, and Neovim — without a reload.
              </li>
              <li>
                <b>OXP Dev — live reload panel</b><br/>
                Run <code>oxp dev</code> in your terminal and see extension changes reflected
                in the IDE in real time. Full Chromium DevTools available for debugging.
              </li>
              <li>
                <b>Capability-based permissions</b><br/>
                Every extension declares the capabilities it needs before activation.
                You review and approve them. Cancel = no install, zero ambient access.
              </li>
            </ul>

            <h2>Quick start</h2>
            <ol>
              <li>Install the OXP CLI: <code>npm i -g @oxprotocol/cli</code></li>
              <li>Install an extension: <code>oxp install @publisher/slug</code></li>
              <li>Open <b>OXP Lens</b> in the right sidebar and toggle the extension ON.</li>
            </ol>

            <h2>Building your own extension</h2>
            <pre>
oxp create my-ext    # scaffold (templates: html, react, rust, tree)
cd my-ext
oxp dev              # live reload in your running IDE
oxp pack             # build a reproducible signed .oxp bundle
oxp publish          # ship to https://oxp.sh
            </pre>

            <h2>Security model</h2>
            <ul>
              <li><b>Sandboxed</b> — no ambient FS, network, or process access.</li>
              <li><b>Verified</b> — sha256 + Ed25519 signature checked on every install.</li>
              <li><b>Allowlisted</b> — net.fetch scopable to specific hosts; fs.read to paths.</li>
              <li><b>No native code</b> — every extension is a pure <code>.wasm</code> component.</li>
            </ul>

            <h2>Links</h2>
            <ul>
              <li>Website — <a href="https://oxp.sh">oxp.sh</a></li>
              <li>Specification — <a href="https://oxp.sh/spec">oxp.sh/spec</a></li>
              <li>CLI &amp; SDK — <a href="https://www.npmjs.com/package/@oxprotocol/cli">npmjs.com/@oxprotocol/cli</a></li>
              <li>Source — <a href="https://github.com/oxprotocol/oxp">github.com/oxprotocol/oxp</a></li>
              <li>Issues — <a href="https://github.com/oxprotocol/oxp/issues">github.com/oxprotocol/oxp/issues</a></li>
            </ul>

            <p><em>Apache-2.0 licensed.</em></p>
        """.trimIndent()

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // No untilBuild — let the platform's compatibility verifier opt us out
            // when something genuinely breaks, instead of silently locking users out.
            untilBuild = provider { null }
        }

        vendor {
            name = "OXP"
            url = "https://oxp.sh"
        }
    }

    pluginVerification {
        ides {
            // Pin verifier IDEs explicitly. `recommended()` resolves bare
            // major.minor coordinates (e.g. `ideaIC:2025.3`) that JetBrains
            // doesn't publish — only `2025.3.x` patch releases exist on the
            // download CDN — so the verify task fails to download the IDE.
            ide("IC", "2025.1.4")
            ide("IC", "2025.2.3")
        }
    }

    // Marketplace publishing. The token is read from the
    // `intellijPublishToken` Gradle property (set in CI via
    // `-PintellijPublishToken=$JETBRAINS_PAT` or
    // `ORG_GRADLE_PROJECT_intellijPublishToken`). Channels default to
    // `default` (stable); pass `-PpublishChannel=beta` to push a
    // pre-release.
    publishing {
        token = providers.gradleProperty("intellijPublishToken")
        channels = providers.gradleProperty("publishChannel")
            .orElse("default")
            .map { listOf(it) }
    }
}

tasks {
    wrapper {
        gradleVersion = providers.gradleProperty("gradleVersion").get()
    }

    // The runtime binary directory is populated by `scripts/stage-runtime.sh`
    // before `buildPlugin`. We don't auto-build the Rust binary here — that
    // belongs in CI, where cross-compilation toolchains are set up properly.
    prepareSandbox {
        from("${project.projectDir}/runtime-bin") {
            into("${pluginName.get()}/runtime-bin")
        }
    }

    test {
        useJUnitPlatform()
    }

    runIde {
        // Forward OXP_LOG so child runtime inherits a useful default during dev.
        systemProperty("oxp.log", System.getenv("OXP_LOG") ?: "info")
    }
}

// ─── Vendor the built plugin into the OXP CLI ────────────────────────────
//
// The CLI ships the JetBrains plugin the same way it ships the VS Code
// VSIX — bundled under `packages/cli/vendor/` and auto-installed by
// `oxp dev`. To keep that artifact in lock-step with whatever the
// Gradle build just produced, this task copies the freshly-built zip
// into the vendor dir and rewrites `oxp-jetbrains.json` with the
// current `pluginVersion`. It runs as a finalizer of `buildPlugin`,
// but only when the build actually succeeded.
val vendorIntoCli by tasks.registering {
    group = "oxp"
    description =
        "Copy the built plugin zip into packages/cli/vendor/ and update oxp-jetbrains.json."

    val pluginVersionProvider = providers.gradleProperty("pluginVersion")
    val pluginNameProvider = providers.gradleProperty("pluginName")
    val distZip = layout.buildDirectory
        .file(pluginNameProvider.zip(pluginVersionProvider) { n, v ->
            "distributions/$n-$v.zip"
        })
    // hosts/jetbrains → repo root is two levels up.
    val vendorDir = layout.projectDirectory.dir("../../packages/cli/vendor")
    val vendorZip = vendorDir.file("oxp-jetbrains.zip")
    val vendorManifest = vendorDir.file("oxp-jetbrains.json")

    inputs.file(distZip)
    inputs.property("version", pluginVersionProvider)
    outputs.file(vendorZip)
    outputs.file(vendorManifest)

    doLast {
        val src = distZip.get().asFile
        require(src.exists()) {
            "Built plugin not found at ${src.absolutePath} — did buildPlugin succeed?"
        }
        val dest = vendorZip.asFile
        dest.parentFile.mkdirs()
        src.copyTo(dest, overwrite = true)

        val version = pluginVersionProvider.get()
        vendorManifest.asFile.writeText(
            """{
  "pluginId": "dev.oxp.jetbrains",
  "version": "$version",
  "zipFile": "oxp-jetbrains.zip",
  "rootDir": "oxp-jetbrains"
}
""",
        )
        logger.lifecycle("✓ vendored ${src.name} → packages/cli/vendor/ (v$version)")
    }
}

tasks.named("buildPlugin") {
    finalizedBy(vendorIntoCli)
}
// Only vendor if buildPlugin actually produced its output. `finalizedBy`
// would otherwise run even on failure, which would either fail loudly
// (no zip) or vendor a stale artifact.
vendorIntoCli {
    onlyIf {
        tasks.named("buildPlugin").get().state.failure == null
    }
}
