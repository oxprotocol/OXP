package dev.oxp.jetbrains.host

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import dev.oxp.jetbrains.protocol.JsonRpcError
import dev.oxp.jetbrains.protocol.RpcException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.attribute.FileTime
import java.time.Duration
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import javax.swing.JOptionPane

/**
 * Per-instance metadata captured at `extension/load` time. Looked up by
 * every capability RPC so we can enforce permission scopes and namespace
 * storage/secrets per (publisher, slug).
 */
data class LoadedExtension(
    val instanceId: String,
    val extensionId: String,
    val permissions: List<String>,
    val hostStorePath: Path,
)

/**
 * Handles every runtime → host capability RPC defined in
 * `spec/v1/host-runtime-rpc.md` §6.1 / §6.2 except UI prompts (those need
 * IDE-thread interaction and live in [UiPromptHandlers]).
 *
 * Contract: [handleRequest] returns the JSON `result` for the JSON-RPC
 * response. For error cases it throws [RpcException] with a -32004
 * PERMISSION_DENIED or -32603 internal envelope, which the RPC client
 * serializes back to the runtime.
 */
object CapabilityHandlers {
    private val log = Logger.getInstance(CapabilityHandlers::class.java)
    private val httpClient: HttpClient by lazy {
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build()
    }

    private val instances = ConcurrentHashMap<String, LoadedExtension>()

    fun register(loaded: LoadedExtension) { instances[loaded.instanceId] = loaded }
    fun unregister(instanceId: String) { instances.remove(instanceId) }

    private fun lookup(params: JsonObject): LoadedExtension {
        val id = params["instanceId"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing instanceId"))
        return instances[id]
            ?: throw RpcException(JsonRpcError(-32008, "unknown instance: $id"))
    }

    fun handleNotification(method: String, params: JsonObject) {
        when (method) {
            "log/write" -> {
                val ext = params["extensionId"]?.jsonPrimitive?.contentOrNull ?: "ext"
                val level = params["level"]?.jsonPrimitive?.contentOrNull ?: "info"
                val message = params["message"]?.jsonPrimitive?.contentOrNull ?: ""
                val l = Logger.getInstance("oxp.$ext")
                when (level) {
                    "error" -> l.warn(message) // IDE Logger has no error() at this level
                    "warn"  -> l.warn(message)
                    "info"  -> l.info(message)
                    "debug" -> l.debug(message)
                    "trace" -> l.trace(message)
                    else    -> l.info(message)
                }
            }
            else -> log.debug("ignoring capability notification: $method")
        }
    }

    fun handleRequest(method: String, params: JsonObject): JsonElement = when (method) {
        // ─── storage ────────────────────────────────────────────────
        "storage/get"    -> storageGet(params)
        "storage/set"    -> storageSet(params)
        "storage/delete" -> storageDelete(params)
        "storage/keys"   -> storageKeys(params)

        // ─── filesystem (gated) ─────────────────────────────────────
        "fs/readFile"  -> fsReadFile(params)
        "fs/writeFile" -> fsWriteFile(params)
        "fs/delete"    -> fsDelete(params)
        "fs/stat"      -> fsStat(params)
        "fs/listDir"   -> fsListDir(params)

        // ─── network (gated) ────────────────────────────────────────
        "net/fetch" -> netFetch(params)

        // ─── secrets (gated) ────────────────────────────────────────
        "secrets/get"    -> secretsGet(params)
        "secrets/set"    -> secretsSet(params)
        "secrets/delete" -> secretsDelete(params)

        // ─── commands (gated) ───────────────────────────────────────
        "commands/execute" -> commandsExecute(params)

        else -> throw RpcException(JsonRpcError(-32601, "Method not found: $method"))
    }

    // ────────────────────────────── storage ──────────────────────────────

    private fun storageDir(loaded: LoadedExtension): Path {
        val dir = loaded.hostStorePath.resolve("storage").resolve(safeId(loaded.extensionId))
        Files.createDirectories(dir)
        return dir
    }

    private fun storageGet(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val key = params["key"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing key"))
        val file = storageDir(loaded).resolve(safeKey(key))
        return buildJsonObject {
            if (Files.exists(file)) {
                val bytes = Files.readAllBytes(file)
                put("value", Base64.getEncoder().encodeToString(bytes))
            } else {
                put("value", JsonNull)
            }
        }
    }

    private fun storageSet(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val key = params["key"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing key"))
        val b64 = params["value"]?.jsonPrimitive?.contentOrNull ?: ""
        val bytes = Base64.getDecoder().decode(b64)
        val file = storageDir(loaded).resolve(safeKey(key))
        Files.write(file, bytes)
        return JsonObject(emptyMap())
    }

    private fun storageDelete(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val key = params["key"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing key"))
        Files.deleteIfExists(storageDir(loaded).resolve(safeKey(key)))
        return JsonObject(emptyMap())
    }

    private fun storageKeys(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val dir = storageDir(loaded)
        val keys = if (Files.exists(dir)) {
            Files.list(dir).use { stream ->
                stream.map { it.fileName.toString() }
                    .map { decodeKey(it) }
                    .toList()
            }
        } else emptyList()
        return buildJsonObject {
            putJsonArray("keys") { keys.forEach { add(it) } }
        }
    }

    // ────────────────────────────── filesystem ──────────────────────────────

    private fun requireFsScope(loaded: LoadedExtension, group: String, path: String) {
        if (!PermissionScope.fsAllows(group, path, loaded.permissions)) {
            throw RpcException(JsonRpcError(
                -32004,
                "$group denied for $path",
                buildJsonObject { put("scope", "$group:$path") },
            ))
        }
    }

    private fun fsReadFile(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val path = params["path"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing path"))
        requireFsScope(loaded, "fs.read", path)
        val bytes = try { Files.readAllBytes(Paths.get(path)) }
            catch (e: java.nio.file.NoSuchFileException) {
                throw RpcException(JsonRpcError(-32603, "not found",
                    buildJsonObject { put("kind", "notFound") }))
            }
        return buildJsonObject {
            put("bytes", Base64.getEncoder().encodeToString(bytes))
        }
    }

    private fun fsWriteFile(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val path = params["path"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing path"))
        requireFsScope(loaded, "fs.write", path)
        val b64 = params["bytes"]?.jsonPrimitive?.contentOrNull ?: ""
        val bytes = Base64.getDecoder().decode(b64)
        val p = Paths.get(path)
        Files.createDirectories(p.parent ?: p)
        Files.write(p, bytes)
        return JsonObject(emptyMap())
    }

    private fun fsDelete(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val path = params["path"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing path"))
        requireFsScope(loaded, "fs.delete", path)
        Files.deleteIfExists(Paths.get(path))
        return JsonObject(emptyMap())
    }

    private fun fsStat(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val path = params["path"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing path"))
        requireFsScope(loaded, "fs.read", path)
        val p = Paths.get(path)
        if (!Files.exists(p)) {
            throw RpcException(JsonRpcError(-32603, "not found",
                buildJsonObject { put("kind", "notFound") }))
        }
        val attrs = Files.readAttributes(p, java.nio.file.attribute.BasicFileAttributes::class.java)
        return buildJsonObject {
            put("size", attrs.size())
            put("isDir", attrs.isDirectory)
            put("mtimeMs", attrs.lastModifiedTime().toMillis())
        }
    }

    private fun fsListDir(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val path = params["path"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing path"))
        requireFsScope(loaded, "fs.read", path)
        val entries = Files.list(Paths.get(path)).use { it.map { p -> p.fileName.toString() }.toList() }
        return buildJsonObject {
            putJsonArray("entries") { entries.forEach { add(it) } }
        }
    }

    // ────────────────────────────── network ──────────────────────────────

    private fun netFetch(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        val url = params["url"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing url"))
        if (!PermissionScope.netAllows(url, loaded.permissions)) {
            throw RpcException(JsonRpcError(-32004, "net.fetch denied for $url",
                buildJsonObject { put("scope", "net.fetch:$url") }))
        }
        val method = params["method"]?.jsonPrimitive?.contentOrNull ?: "GET"
        val headers = params["headers"]?.jsonArray ?: JsonArray(emptyList())
        val bodyB64 = params["body"]?.let {
            if (it is JsonNull) null else it.jsonPrimitive.contentOrNull
        }

        val body = if (bodyB64 != null) {
            HttpRequest.BodyPublishers.ofByteArray(Base64.getDecoder().decode(bodyB64))
        } else HttpRequest.BodyPublishers.noBody()

        val builder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(30))
            .method(method.uppercase(), body)
        // HttpClient blocks a small set of headers ("host", "content-length", …).
        // Skipping silently on IllegalArgumentException keeps the extension's
        // request semantically correct without us hand-curating the list.
        headers.forEach { entry ->
            val pair = entry.jsonArray
            val name = pair.getOrNull(0)?.jsonPrimitive?.contentOrNull ?: return@forEach
            val value = pair.getOrNull(1)?.jsonPrimitive?.contentOrNull ?: return@forEach
            try { builder.header(name, value) } catch (_: IllegalArgumentException) {}
        }

        val resp: HttpResponse<ByteArray> = try {
            httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray())
        } catch (e: java.net.http.HttpTimeoutException) {
            throw RpcException(JsonRpcError(-32603, "timeout",
                buildJsonObject { put("kind", "timeout") }))
        } catch (e: Exception) {
            throw RpcException(JsonRpcError(-32603, "transport: ${e.message}"))
        }

        return buildJsonObject {
            put("status", resp.statusCode())
            putJsonArray("headers") {
                resp.headers().map().forEach { (k, vs) ->
                    vs.forEach { v -> add(buildJsonArray { add(k); add(v) }) }
                }
            }
            put("body", Base64.getEncoder().encodeToString(resp.body()))
        }
    }

    // ────────────────────────────── secrets ──────────────────────────────

    private fun secretsAttributes(loaded: LoadedExtension, key: String): CredentialAttributes =
        // Per (publisher, slug) namespace. PasswordSafe's serviceName is a
        // free-form string; we structure it so a malicious extension can't
        // collide with another's keys.
        CredentialAttributes("oxp:${safeId(loaded.extensionId)}:$key")

    private fun secretsGet(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        if (!PermissionScope.has("secrets.read", loaded.permissions)) {
            throw RpcException(JsonRpcError(-32004, "secrets.read denied",
                buildJsonObject { put("scope", "secrets.read") }))
        }
        val key = params["key"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing key"))
        val pwd = PasswordSafe.instance.getPassword(secretsAttributes(loaded, key))
        return buildJsonObject {
            if (pwd == null) put("value", JsonNull) else put("value", pwd)
        }
    }

    private fun secretsSet(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        if (!PermissionScope.has("secrets.write", loaded.permissions)) {
            throw RpcException(JsonRpcError(-32004, "secrets.write denied",
                buildJsonObject { put("scope", "secrets.write") }))
        }
        val key = params["key"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing key"))
        val value = params["value"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing value"))
        PasswordSafe.instance.set(secretsAttributes(loaded, key), Credentials(key, value))
        return JsonObject(emptyMap())
    }

    private fun secretsDelete(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        if (!PermissionScope.has("secrets.write", loaded.permissions)) {
            throw RpcException(JsonRpcError(-32004, "secrets.write denied",
                buildJsonObject { put("scope", "secrets.write") }))
        }
        val key = params["key"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing key"))
        PasswordSafe.instance.set(secretsAttributes(loaded, key), null)
        return JsonObject(emptyMap())
    }

    // ────────────────────────────── commands ──────────────────────────────

    private fun commandsExecute(params: JsonObject): JsonElement {
        val loaded = lookup(params)
        if (!PermissionScope.has("commands.executeHost", loaded.permissions)) {
            throw RpcException(JsonRpcError(-32004, "commands.executeHost denied",
                buildJsonObject { put("scope", "commands.executeHost") }))
        }
        val commandId = params["commandId"]?.jsonPrimitive?.contentOrNull
            ?: throw RpcException(JsonRpcError(-32602, "missing commandId"))
        val action = ActionManager.getInstance().getAction(commandId)
            ?: throw RpcException(JsonRpcError(-32603, "unknown action: $commandId"))

        // Marshal to EDT — IntelliJ actions assume the swing thread.
        val app = ApplicationManager.getApplication()
        app.invokeAndWait {
            val ctx = com.intellij.openapi.actionSystem.impl.SimpleDataContext.builder().build()
            val event = AnActionEvent.createFromAnAction(action, null, "OXP", ctx)
            action.actionPerformed(event)
        }
        return buildJsonObject { put("resultJson", "null") }
    }

    // ────────────────────────────── helpers ──────────────────────────────

    /**
     * Sanitize an extension id (`@scope/name@1.2.3`) for use as a directory
     * or service-name segment. We keep ASCII alphanumerics, `-`, `_`, `.`;
     * everything else becomes `_`.
     */
    private fun safeId(s: String): String =
        buildString(s.length) {
            for (c in s) {
                when {
                    c.isLetterOrDigit() || c == '-' || c == '_' || c == '.' -> append(c)
                    else -> append('_')
                }
            }
        }

    /** Storage keys are hex-encoded so any byte sequence becomes a safe filename. */
    private fun safeKey(key: String): String =
        key.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) }

    private fun decodeKey(filename: String): String {
        if (filename.length % 2 != 0) return filename
        val bytes = ByteArray(filename.length / 2)
        var i = 0
        while (i < filename.length) {
            bytes[i / 2] = filename.substring(i, i + 2).toInt(16).toByte()
            i += 2
        }
        return String(bytes, Charsets.UTF_8)
    }
}
