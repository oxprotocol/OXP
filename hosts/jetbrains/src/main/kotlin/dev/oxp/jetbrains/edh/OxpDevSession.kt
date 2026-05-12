package dev.oxp.jetbrains.edh

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ex.ProjectManagerEx
import com.intellij.openapi.wm.ToolWindowManager
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.atomic.AtomicReference

/**
 * Project-scoped EDH session. Owns the WebSocket connection to a running
 * `oxp dev` process and exposes its state to the OXP Dev tool window.
 *
 * Lifecycle: created lazily by [EdhStartupActivity] via
 * `project.getService(OxpDevSession::class.java)`, then `attach(payload)`
 * connects the WS. Disposed automatically on project close, which closes
 * the WS and clears the latest-reload state.
 *
 * Wire protocol (server → client):
 *   { kind:"reload", manifest, digest, bundle:base64, builtAt, dev }
 *   { kind:"error", message }
 *   { kind:"shutdown" }
 *
 * Client → server (sendCommand / log):
 *   { kind:"command", id }
 *   { kind:"oxp:dev:log", level, message }
 */
@Service(Service.Level.PROJECT)
class OxpDevSession(private val project: Project) : Disposable {

    sealed class Status {
        object Idle : Status()
        data class Connecting(val wsUrl: String) : Status()
        data class Connected(val wsUrl: String) : Status()
        data class Error(val wsUrl: String, val message: String) : Status()
        data class Disconnected(val wsUrl: String) : Status()
        object Shutdown : Status()
    }

    /** A single hot-reload snapshot. */
    data class Reload(
        val manifest: JsonObject,
        val digest: String,
        val builtAt: Long,
        /** Derived `http://host:port` from wsUrl (no trailing slash). */
        val httpBase: String,
    ) {
        val id: String? get() = (manifest["id"] as? JsonPrimitive)?.contentOrNullSafe()
        val version: String? get() = (manifest["version"] as? JsonPrimitive)?.contentOrNullSafe()
        /** Relative path inside the bundle of the main UI file, if any. */
        val mainUi: String?
            get() = ((manifest["main"] as? JsonObject)?.get("ui") as? JsonPrimitive)
                ?.contentOrNullSafe()
        /** Relative path inside the bundle of the manifest icon, if any. */
        val iconPath: String?
            get() = (manifest["icon"] as? JsonPrimitive)?.contentOrNullSafe()
        /** Absolute http URL the dev server serves the icon from, if any. */
        val iconUrl: String?
            get() = iconPath?.let { "$httpBase/$it" }
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val statusRef = AtomicReference<Status>(Status.Idle)
    private val reloadRef = AtomicReference<Reload?>(null)
    private val listeners = mutableListOf<(Status, Reload?) -> Unit>()
    private val lock = Any()

    @Volatile private var wsClient: HttpClient? = null
    @Volatile private var ws: WebSocket? = null
    @Volatile private var payload: EdhMarker.Payload? = null
    @Volatile private var disposed = false

    val status: Status get() = statusRef.get()
    val latestReload: Reload? get() = reloadRef.get()
    val wsUrl: String? get() = payload?.wsUrl
    val httpBase: String? get() = payload?.wsUrl?.let(::deriveHttpBase)
    val forkBin: String? get() = payload?.forkBin

    // ── Public API ───────────────────────────────────────────────────

    /** Attach to the WS URL carried by an EDH marker. Idempotent. */
    fun attach(p: EdhMarker.Payload) {
        if (disposed) return
        if (this.payload?.wsUrl == p.wsUrl && ws != null) return
        synchronized(lock) {
            this.payload = p
            setStatus(Status.Connecting(p.wsUrl))
            connect(p.wsUrl)
        }
    }

    /** Send `{kind:"command", id}` to the dev server. */
    fun sendCommand(id: String) {
        sendJson(buildString {
            append("{\"kind\":\"command\",\"id\":")
            append(jsonString(id))
            append('}')
        })
    }

    /** Send a host-side dev log line. Logged to OXP notifications too. */
    fun log(level: String, message: String) {
        thisLogger().info("[oxp dev] [$level] $message")
        sendJson(buildString {
            append("{\"kind\":\"oxp:dev:log\",\"level\":")
            append(jsonString(level))
            append(",\"message\":")
            append(jsonString(message))
            append('}')
        })
    }

    /**
     * Subscribe to status / reload events. The listener is invoked
     * immediately with current state and again on every change. Returns
     * an unsubscribe handle.
     */
    fun addListener(listener: (Status, Reload?) -> Unit): () -> Unit {
        synchronized(lock) {
            listeners.add(listener)
        }
        // Fire current state synchronously.
        listener(statusRef.get(), reloadRef.get())
        return {
            synchronized(lock) { listeners.remove(listener) }
        }
    }

    override fun dispose() {
        disposed = true
        try {
            ws?.sendClose(WebSocket.NORMAL_CLOSURE, "project closed")
        } catch (_: Throwable) { /* best-effort */ }
        ws = null
        wsClient = null
        synchronized(lock) { listeners.clear() }
    }

    // ── Connect ──────────────────────────────────────────────────────

    private fun connect(wsUrl: String) {
        val client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build()
        wsClient = client
        try {
            client.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .buildAsync(URI.create(wsUrl), Listener())
                .whenComplete { sock, err ->
                    if (err != null) {
                        thisLogger().warn("OXP dev: WS connect failed: ${err.message}")
                        setStatus(Status.Error(wsUrl, err.message ?: "connect failed"))
                    } else {
                        ws = sock
                        setStatus(Status.Connected(wsUrl))
                    }
                }
        } catch (t: Throwable) {
            setStatus(Status.Error(wsUrl, t.message ?: "connect failed"))
        }
    }

    private fun sendJson(text: String) {
        val sock = ws ?: return
        try {
            sock.sendText(text, true)
        } catch (t: Throwable) {
            thisLogger().warn("OXP dev: WS send failed: ${t.message}")
        }
    }

    private fun setStatus(s: Status) {
        statusRef.set(s)
        fireListeners()
    }

    private fun fireListeners() {
        val snapshot = synchronized(lock) { listeners.toList() }
        val s = statusRef.get()
        val r = reloadRef.get()
        for (l in snapshot) {
            try { l(s, r) } catch (t: Throwable) {
                thisLogger().warn("OXP dev: listener threw", t)
            }
        }
    }

    private fun handleMessage(text: String) {
        val obj: JsonObject = try {
            json.parseToJsonElement(text).jsonObject
        } catch (t: Throwable) {
            thisLogger().warn("OXP dev: bad WS message: ${t.message}")
            return
        }
        when ((obj["kind"] as? JsonPrimitive)?.contentOrNullSafe()) {
            "reload" -> onReload(obj)
            "error" -> onErrorMsg(obj)
            "shutdown" -> onShutdown()
            "command" -> { /* re-broadcast from CLI — no-op for us */ }
            else -> { /* unknown — ignore */ }
        }
    }

    private fun onReload(obj: JsonObject) {
        val manifest = obj["manifest"] as? JsonObject ?: return
        val digest = (obj["digest"] as? JsonPrimitive)?.contentOrNullSafe().orEmpty()
        val builtAt = (obj["builtAt"] as? JsonPrimitive)?.longOrNull() ?: System.currentTimeMillis()
        val httpBase = httpBase ?: return
        val r = Reload(manifest, digest, builtAt, httpBase)
        reloadRef.set(r)
        val url = payload?.wsUrl ?: return
        setStatus(Status.Connected(url))
    }

    private fun onErrorMsg(obj: JsonObject) {
        val msg = (obj["message"] as? JsonPrimitive)?.contentOrNullSafe()
            ?: "unknown dev error"
        val url = payload?.wsUrl ?: return
        setStatus(Status.Error(url, msg))
        notify(msg, NotificationType.ERROR)
    }

    private fun onShutdown() {
        setStatus(Status.Shutdown)
        notify(
            "OXP dev server stopped — closing Extension Development Host…",
            NotificationType.INFORMATION,
        )
        // Mirror VS Code's UX: when `oxp dev` exits, the EDH window
        // closes itself. We schedule project close on the EDT.
        ApplicationManager.getApplication().invokeLater {
            if (!disposed && !project.isDisposed) {
                ProjectManagerEx.getInstanceEx().closeAndDispose(project)
            }
        }
    }

    private fun notify(msg: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            NotificationGroupManager.getInstance()
                .getNotificationGroup("OXP")
                .createNotification(msg, type)
                .notify(project)
        }
    }

    // ── WebSocket listener ───────────────────────────────────────────

    private inner class Listener : WebSocket.Listener {
        private val buffer = StringBuilder()

        override fun onOpen(webSocket: WebSocket) {
            webSocket.request(1)
        }

        override fun onText(
            webSocket: WebSocket,
            data: CharSequence,
            last: Boolean,
        ): CompletionStage<*>? {
            buffer.append(data)
            if (last) {
                val text = buffer.toString()
                buffer.setLength(0)
                handleMessage(text)
            }
            webSocket.request(1)
            return null
        }

        override fun onClose(
            webSocket: WebSocket,
            statusCode: Int,
            reason: String,
        ): CompletionStage<*>? {
            val url = payload?.wsUrl
            if (!disposed && url != null && statusRef.get() !is Status.Shutdown) {
                setStatus(Status.Disconnected(url))
            }
            return CompletableFuture.completedFuture<Any?>(null)
        }

        override fun onError(webSocket: WebSocket, error: Throwable) {
            val url = payload?.wsUrl ?: return
            if (!disposed) {
                setStatus(Status.Error(url, error.message ?: "WS error"))
            }
        }
    }

    companion object {
        /**
         * Convert `ws[s]://host:port/dev` → `http[s]://host:port`. Used by
         * the tool window to load `/ui/<path>` over plain HTTP. Returns
         * the input unchanged if it doesn't start with `ws`.
         */
        fun deriveHttpBase(wsUrl: String): String {
            val u = URI.create(wsUrl)
            val scheme = when (u.scheme?.lowercase()) {
                "ws" -> "http"
                "wss" -> "https"
                else -> return wsUrl
            }
            val authority = u.authority ?: return wsUrl
            return "$scheme://$authority"
        }

        /** JSON-encode a string with quotes and escapes — no external dep. */
        private fun jsonString(s: String): String {
            val sb = StringBuilder(s.length + 2)
            sb.append('"')
            for (c in s) {
                when (c) {
                    '\\' -> sb.append("\\\\")
                    '"' -> sb.append("\\\"")
                    '\b' -> sb.append("\\b")
                    '\u000C' -> sb.append("\\f")
                    '\n' -> sb.append("\\n")
                    '\r' -> sb.append("\\r")
                    '\t' -> sb.append("\\t")
                    else -> if (c.code < 0x20) {
                        sb.append(String.format("\\u%04x", c.code))
                    } else sb.append(c)
                }
            }
            sb.append('"')
            return sb.toString()
        }
    }
}

// Top-level extension fns so members and the data class can both share them.
private fun JsonPrimitive.contentOrNullSafe(): String? =
    try { this.content } catch (_: Throwable) { null }

private fun JsonPrimitive.longOrNull(): Long? =
    try { this.content.toLong() } catch (_: Throwable) { null }
