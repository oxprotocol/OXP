rootProject.name = "oxp-jetbrains"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

// Foojay resolver lets Gradle auto-download a JDK matching `jvmToolchain(21)`
// declared in build.gradle.kts. No manual JDK install required for contributors.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}
