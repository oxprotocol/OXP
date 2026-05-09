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
            recommended()
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
