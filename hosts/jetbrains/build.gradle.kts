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
        name = "OXP — Open Extension Protocol"
        version = providers.gradleProperty("pluginVersion")

        description = """
            Run universal OXP extensions (.wasm components) inside any JetBrains IDE.
            One extension binary, every editor — see https://oxprotocol.org.
        """.trimIndent()

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // No untilBuild — let the platform's compatibility verifier opt us out
            // when something genuinely breaks, instead of silently locking users out.
            untilBuild = provider { null }
        }

        vendor {
            name = "OXP"
            url = "https://oxprotocol.org"
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
