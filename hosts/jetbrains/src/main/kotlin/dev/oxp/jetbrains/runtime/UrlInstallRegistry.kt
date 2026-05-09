package dev.oxp.jetbrains.runtime

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path

/**
 * Read-only view of the cross-host URL-install registry.
 *
 * Mirrors `packages/host-core/src/url-installs.ts`. The `oxp install-url`
 * CLI populates `<oxpHome>/host-store/url-installs/<sha256>/` with a
 * `bundle.wasm` and a `meta.json`. Both the VS Code and JetBrains plugins
 * read the same directory so an install made anywhere is immediately
 * visible everywhere.
 *
 * We only *read* — recording is the CLI's job. Hosts always go through the
 * permission prompt before activating an entry from this list.
 */
object UrlInstallRegistry {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    data class Meta(
        val sha256: String,
        val sourceUrl: String,
        val suggestedId: String,
        val size: Long,
        val installedAt: String,
        val grantedPermissions: List<String>? = null,
    )

    data class Entry(
        val meta: Meta,
        val bundlePath: Path,
    )

    /** `<oxpHome>/host-store/url-installs`. */
    fun root(oxpHome: Path): Path =
        oxpHome.resolve("host-store").resolve("url-installs")

    /**
     * Return all readable entries, newest-first by `installedAt`.
     * Skips half-written or corrupt entries silently — mirrors the TS
     * implementation. Returns an empty list if the directory does not exist.
     */
    fun list(oxpHome: Path): List<Entry> {
        val dir = root(oxpHome)
        if (!Files.isDirectory(dir)) return emptyList()
        val out = mutableListOf<Entry>()
        Files.newDirectoryStream(dir).use { stream ->
            for (sub in stream) {
                if (!Files.isDirectory(sub)) continue
                val bundle = sub.resolve("bundle.wasm")
                val meta = sub.resolve("meta.json")
                if (!Files.isRegularFile(bundle) || !Files.isRegularFile(meta)) continue
                try {
                    val parsed = json.decodeFromString(Meta.serializer(), Files.readString(meta))
                    out += Entry(parsed, bundle)
                } catch (_: SerializationException) {
                    // Skip malformed meta.json
                } catch (_: Exception) {
                    // Skip unreadable entries
                }
            }
        }
        out.sortByDescending { it.meta.installedAt }
        return out
    }
}
