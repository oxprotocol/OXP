package dev.oxp.jetbrains.edh

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Cross-host EDH (Extension Development Host) handshake marker.
 *
 * `oxp dev` writes a JSON marker at `$OXP_HOME/edh/autostart.json`
 * (default `~/.oxp/edh/autostart.json`) after binding its WebSocket
 * port. The plugin's [EdhStartupActivity] reads it on every project
 * open, validates folder + freshness, then attaches to `wsUrl`
 * directly — there is exactly one `oxp dev` per session.
 *
 * Schema is v1, identical to `packages/cli/src/lib/edh-marker.ts`:
 *
 *   { v:1, ts, folderPath, wsUrl, forkBin? }
 *
 * Unknown future fields are ignored.
 */
object EdhMarker {
    private val json = Json { ignoreUnknownKeys = true }
    private const val TTL_MS = 60_000L
    const val SCHEMA_VERSION = 1

    @Serializable
    data class Payload(
        val v: Int = SCHEMA_VERSION,
        val ts: Long,
        val folderPath: String,
        val wsUrl: String = "",
        val forkBin: String? = null,
    )

    fun path(): Path {
        val home = System.getenv("OXP_HOME")
            ?: Paths.get(
                System.getProperty("user.home") ?: "/tmp",
                ".oxp",
            ).toString()
        return Paths.get(home, "edh", "autostart.json")
    }

    /**
     * In-process helper used by [StartDevSessionAction]. Writes a marker
     * with the current timestamp and folder path. No wsUrl is set: the
     * consuming window will spawn `oxp dev` itself in that legacy flow.
     */
    fun write(folderPath: String) {
        val p = path()
        Files.createDirectories(p.parent)
        val payload = Payload(
            ts = System.currentTimeMillis(),
            folderPath = folderPath,
        )
        Files.writeString(p, json.encodeToString(Payload.serializer(), payload))
    }

    /**
     * Consume the marker iff it matches `projectBasePath` and is < 60s
     * old. Returns the parsed payload (so the caller can read `wsUrl`)
     * or null if no fresh, matching marker is present. The marker is
     * deleted on consume so concurrent windows don't double-fire.
     */
    fun consumeIfMatches(projectBasePath: String?): Payload? {
        if (projectBasePath == null) return null
        val p = path()
        if (!Files.exists(p)) return null

        val payload: Payload = try {
            json.decodeFromString(Payload.serializer(), Files.readString(p))
        } catch (_: Exception) {
            tryDelete(p)
            return null
        }

        if (System.currentTimeMillis() - payload.ts > TTL_MS) {
            tryDelete(p)
            return null
        }

        if (!sameFolder(payload.folderPath, projectBasePath)) {
            // Not for us — leave the marker for the right window.
            return null
        }

        tryDelete(p)
        return payload
    }

    /**
     * Compare two folder paths for "same target" without forcing the
     * caller to canonicalize. Handles trailing slashes and macOS's
     * `/private/var` ↔ `/var` symlink quirk where realpath differs.
     */
    private fun sameFolder(a: String, b: String): Boolean {
        if (a == b) return true
        val na = a.trimEnd('/', '\\')
        val nb = b.trimEnd('/', '\\')
        if (na == nb) return true
        return try {
            Paths.get(na).toRealPath() == Paths.get(nb).toRealPath()
        } catch (_: Exception) {
            false
        }
    }

    private fun tryDelete(p: Path) {
        try {
            Files.deleteIfExists(p)
        } catch (_: Exception) {
            // best-effort
        }
    }
}
