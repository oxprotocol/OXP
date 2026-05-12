package dev.oxp.jetbrains.runtime

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path

/**
 * Read-only view of the shared OXP install store at
 * `<oxpHome>/host-store/extensions/<publisher>/<slug>/<version>/`.
 *
 * Mirrors `packages/host-core/src/store.ts`. Both the VS Code and
 * JetBrains plugins read the same directory so an `oxp install` made
 * anywhere is immediately visible everywhere.
 *
 * We only *read* — installation is the CLI's job. Hosts always go
 * through the permission prompt before activating an entry.
 */
object InstalledStoreReader {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Minimal manifest view — just the bits the JB tool window needs
     * to render a row and pick the activation path (ui-v1 HTML vs
     * wasm component).
     */
    data class Manifest(
        val id: String,
        val version: String,
        val displayName: String?,
        val description: String?,
        /** Relative path to entry .wasm component, if any. */
        val mainComponent: String?,
        /** Relative path to ui-v1 HTML, if any. */
        val mainUi: String?,
        val raw: JsonObject,
    )

    data class Entry(
        val manifest: Manifest,
        /** Absolute path of `<root>/<pub>/<slug>/<version>/`. */
        val installDir: Path,
    ) {
        /** "ui-v1" if HTML-only, "component" if wasm-backed, else "mixed". */
        val kind: String get() = when {
            manifest.mainComponent != null -> "component"
            manifest.mainUi != null -> "ui-v1"
            else -> "unknown"
        }
    }

    /** `<oxpHome>/host-store/extensions`. */
    fun root(oxpHome: Path): Path =
        oxpHome.resolve("host-store").resolve("extensions")

    /** Default `<oxpHome>` resolution mirroring the CLI. */
    fun defaultOxpHome(): Path {
        val env = System.getenv("OXP_HOME")
        return if (!env.isNullOrBlank()) Path.of(env)
        else Path.of(System.getProperty("user.home"), ".oxp")
    }

    /**
     * All readable installed extensions, sorted by id. Skips malformed
     * or half-written entries. Returns an empty list if the directory
     * does not exist (i.e. nothing installed yet).
     */
    fun list(oxpHome: Path = defaultOxpHome()): List<Entry> {
        val dir = root(oxpHome)
        if (!Files.isDirectory(dir)) return emptyList()
        val out = mutableListOf<Entry>()
        Files.newDirectoryStream(dir).use { publishers ->
            for (pub in publishers) {
                if (!Files.isDirectory(pub)) continue
                Files.newDirectoryStream(pub).use { slugs ->
                    for (slug in slugs) {
                        if (!Files.isDirectory(slug)) continue
                        // Pick the newest installed version per slug.
                        val latest = Files.newDirectoryStream(slug).use { versions ->
                            versions.filter { Files.isDirectory(it) }
                                .maxByOrNull { it.fileName.toString() }
                        } ?: continue
                        val parsed = readManifest(latest) ?: continue
                        out += Entry(parsed, latest)
                    }
                }
            }
        }
        out.sortBy { it.manifest.id }
        return out
    }

    /** Read `<dir>/oxp.json` into a minimal Manifest. */
    fun readManifest(dir: Path): Manifest? {
        val file = dir.resolve("oxp.json")
        if (!Files.isRegularFile(file)) return null
        return try {
            val obj = json.parseToJsonElement(Files.readString(file)).jsonObject
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return null
            val version = obj["version"]?.jsonPrimitive?.contentOrNull ?: return null
            val displayName = obj["displayName"]?.jsonPrimitive?.contentOrNull
            val description = obj["description"]?.jsonPrimitive?.contentOrNull
            val main = obj["main"]?.jsonObject
            val mainComponent = main?.get("component")?.jsonPrimitive?.contentOrNull
            val mainUi = main?.get("ui")?.jsonPrimitive?.contentOrNull
            Manifest(id, version, displayName, description, mainComponent, mainUi, obj)
        } catch (_: SerializationException) {
            null
        } catch (_: Exception) {
            null
        }
    }

    /** Look up a specific extension by id (`@pub/slug`), newest version. */
    fun get(id: String, oxpHome: Path = defaultOxpHome()): Entry? =
        list(oxpHome).firstOrNull { it.manifest.id == id }
}
