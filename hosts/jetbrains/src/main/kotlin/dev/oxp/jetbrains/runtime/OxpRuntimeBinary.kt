package dev.oxp.jetbrains.runtime

import com.intellij.openapi.application.PathManager
import com.intellij.util.system.CpuArch
import com.intellij.util.system.OS
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import kotlin.io.path.exists

/**
 * Locates (and on first use, extracts) the bundled `oxp-runtime` binary
 * matching the current OS and CPU. The plugin .zip ships six binaries:
 *
 *   runtime-bin/macos-aarch64/oxp-runtime
 *   runtime-bin/macos-x86_64/oxp-runtime
 *   runtime-bin/linux-aarch64/oxp-runtime
 *   runtime-bin/linux-x86_64/oxp-runtime
 *   runtime-bin/windows-aarch64/oxp-runtime.exe
 *   runtime-bin/windows-x86_64/oxp-runtime.exe
 *
 * On Unix we also chmod +x — JAR extraction strips the bit.
 */
object OxpRuntimeBinary {
    private val targetTriple: String by lazy {
        val osPart = when {
            OS.CURRENT == OS.macOS -> "macos"
            OS.CURRENT == OS.Linux -> "linux"
            OS.CURRENT == OS.Windows -> "windows"
            else -> error("Unsupported OS: ${OS.CURRENT}")
        }
        val archPart = when (CpuArch.CURRENT) {
            CpuArch.ARM64 -> "aarch64"
            CpuArch.X86_64 -> "x86_64"
            else -> error("Unsupported CPU arch: ${CpuArch.CURRENT}")
        }
        "$osPart-$archPart"
    }

    private val binaryName: String =
        if (OS.CURRENT == OS.Windows) "oxp-runtime.exe" else "oxp-runtime"

    /**
     * Returns an absolute, executable path to the runtime binary for this
     * platform. Resolution order:
     *   1. $OXP_RUNTIME env var (explicit override, dev workflow)
     *   2. Bundled copy under the plugin's installation directory
     *   3. <repo>/runtime/target/{release,debug}/oxp-runtime (dev / runIde)
     */
    fun resolve(): Path {
        // 1. Explicit override.
        System.getenv("OXP_RUNTIME")?.takeIf { it.isNotBlank() }?.let { override ->
            val p = Path.of(override)
            check(p.exists()) { "OXP_RUNTIME=$override but file does not exist" }
            return p
        }

        // 2. Bundled binary inside the installed plugin.
        bundledRoot()?.let { root ->
            val bundled = root.resolve("runtime-bin").resolve(targetTriple).resolve(binaryName)
            if (bundled.exists()) {
                return materialize(bundled)
            }
        }

        // 3. Dev fallback: a sibling repo build.
        devRepoBinary()?.let { return materialize(it) }

        error(
            "Could not locate oxp-runtime for $targetTriple. " +
                "Set OXP_RUNTIME, or run hosts/jetbrains/scripts/stage-runtime.sh, " +
                "or build runtime/ via `cargo build` so a debug binary is available."
        )
    }

    /**
     * Plugin install root, if discoverable. Returns null when running from
     * exploded class directories (e.g. `./gradlew runIde`) where the
     * CodeSource has no URL location.
     */
    private fun bundledRoot(): Path? {
        val codeSource = OxpRuntimeBinary::class.java.protectionDomain?.codeSource ?: return null
        val location = codeSource.location ?: return null
        val jarPath = runCatching { Path.of(location.toURI()) }.getOrNull() ?: return null
        // Installed layout: <pluginRoot>/lib/<artifact>.jar
        val parent = jarPath.parent ?: return null
        return parent.parent
    }

    /**
     * Walk upward from the working directory looking for
     * `runtime/target/{release,debug}/oxp-runtime`. Used when running under
     * `./gradlew runIde` from the OXP repo.
     */
    private fun devRepoBinary(): Path? {
        var dir: Path? = Path.of(System.getProperty("user.dir")).toAbsolutePath()
        repeat(8) {
            val cur = dir ?: return null
            for (profile in listOf("release", "debug")) {
                val candidate = cur.resolve("runtime").resolve("target").resolve(profile).resolve(binaryName)
                if (candidate.exists()) return candidate
            }
            dir = cur.parent
        }
        return null
    }

    /** Copy into the IDE config dir so the bit is set & writable. */
    private fun materialize(source: Path): Path {
        val cacheDir = Path.of(PathManager.getSystemPath(), "oxp", "runtime", targetTriple)
        Files.createDirectories(cacheDir)
        val cached = cacheDir.resolve(binaryName)
        if (!cached.exists() || Files.size(cached) != Files.size(source)) {
            Files.copy(source, cached, StandardCopyOption.REPLACE_EXISTING)
            makeExecutable(cached)
        }
        return cached
    }

    private fun makeExecutable(path: Path) {
        if (OS.CURRENT == OS.Windows) return
        runCatching {
            val perms = Files.getPosixFilePermissions(path).toMutableSet()
            perms += PosixFilePermission.OWNER_EXECUTE
            perms += PosixFilePermission.GROUP_EXECUTE
            perms += PosixFilePermission.OTHERS_EXECUTE
            Files.setPosixFilePermissions(path, perms)
        }
    }
}
