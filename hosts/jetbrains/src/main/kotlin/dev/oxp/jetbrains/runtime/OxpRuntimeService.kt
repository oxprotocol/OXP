package dev.oxp.jetbrains.runtime

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.util.system.CpuArch
import com.intellij.util.system.OS
import dev.oxp.jetbrains.host.CapabilityHandlers
import dev.oxp.jetbrains.host.HostCapabilities
import dev.oxp.jetbrains.host.LoadedExtension
import dev.oxp.jetbrains.protocol.CommandParams
import dev.oxp.jetbrains.protocol.CommandResult
import dev.oxp.jetbrains.protocol.HostInfo
import dev.oxp.jetbrains.protocol.InitializeParams
import dev.oxp.jetbrains.protocol.InitializeResult
import dev.oxp.jetbrains.protocol.InstanceRef
import dev.oxp.jetbrains.protocol.LoadParams
import dev.oxp.jetbrains.protocol.LoadResult
import dev.oxp.jetbrains.protocol.RpcClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap

/**
 * Application-level service that owns the single `oxp-runtime` subprocess
 * shared across all open projects in this IDE instance. Lazy-started on
 * first use; safe to call from EDT (work happens on a background scope).
 *
 * Threading: all RPC calls happen on [scope] (Dispatchers.IO). Callers
 * marshal results back to EDT themselves when needed.
 */
@Service(Service.Level.APP)
class OxpRuntimeService : Disposable {
    private val log = Logger.getInstance(OxpRuntimeService::class.java)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val startMutex = Mutex()

    @Volatile private var process: Process? = null
    @Volatile private var rpc: RpcClient? = null
    @Volatile private var initResult: InitializeResult? = null
    @Volatile private var hostStorePath: Path? = null

    private val instances = ConcurrentHashMap<String, LoadResult>()

    /** Subscribers for runtime-initiated UI render notifications. */
    private val uiRenderListeners = java.util.concurrent.CopyOnWriteArrayList<(UiRenderEvent) -> Unit>()
    private val uiStatusListeners = java.util.concurrent.CopyOnWriteArrayList<(UiStatusEvent) -> Unit>()
    private val uiNotifyListeners = java.util.concurrent.CopyOnWriteArrayList<(UiNotifyEvent) -> Unit>()

    fun addUiRenderListener(l: (UiRenderEvent) -> Unit): () -> Unit {
        uiRenderListeners.add(l); return { uiRenderListeners.remove(l) }
    }
    fun addUiStatusListener(l: (UiStatusEvent) -> Unit): () -> Unit {
        uiStatusListeners.add(l); return { uiStatusListeners.remove(l) }
    }
    fun addUiNotifyListener(l: (UiNotifyEvent) -> Unit): () -> Unit {
        uiNotifyListeners.add(l); return { uiNotifyListeners.remove(l) }
    }

    /**
     * Ensures the runtime is started and `initialize` has completed.
     * Idempotent — concurrent callers share one start operation.
     */
    suspend fun ensureStarted(): RpcClient {
        rpc?.let { return it }
        return startMutex.withLock {
            rpc?.let { return@withLock it }
            startInternal()
        }
    }

    private suspend fun startInternal(): RpcClient {
        val binary = withContext(Dispatchers.IO) { OxpRuntimeBinary.resolve() }
        log.info("starting oxp-runtime: $binary")

        val pb = ProcessBuilder(binary.toString(), "--host", "jetbrains")
            .redirectErrorStream(false)
        pb.environment()["OXP_LOG"] = System.getProperty("oxp.log", "info")
        val proc = pb.start()
        process = proc

        // Drain stderr into IDE log so runtime tracing isn't lost.
        Thread({
            BufferedReader(InputStreamReader(proc.errorStream)).useLines { lines ->
                lines.forEach { log.info("[oxp-runtime] $it") }
            }
        }, "oxp-runtime-stderr").apply { isDaemon = true }.start()

        val client = RpcClient(
            out = proc.outputStream,
            input = proc.inputStream,
            onNotification = { method, params -> handleNotification(method, params) },
            onRequest = { method, params -> handleRequest(method, params) },
        )
        client.start()
        rpc = client

        val appInfo = ApplicationInfo.getInstance()
        val storePath = Path.of(PathManager.getSystemPath(), "oxp", "store")
        hostStorePath = storePath
        val init = client.request<InitializeParams, InitializeResult>(
            method = "initialize",
            params = InitializeParams(
                protocolVersion = "1.0",
                host = HostInfo(
                    id = "jetbrains",
                    version = "${appInfo.fullApplicationName} (${appInfo.build.asString()})",
                    platform = "${osPart()}-${archPart()}",
                ),
                capabilities = HostCapabilities.build(),
                hostStorePath = storePath.toString(),
            ),
        )
        initResult = init
        log.info("oxp-runtime initialized: ${init.runtimeVersion} engine=${init.wasmEngine}")
        return client
    }

    suspend fun load(params: LoadParams): LoadResult {
        val client = ensureStarted()
        val result = client.request<LoadParams, LoadResult>("extension/load", params)
        instances[result.instanceId] = result
        // Hand permissions + storage root to the capability layer so every
        // subsequent runtime → host RPC can scope-check and namespace.
        val storeRoot = hostStorePath ?: Path.of(PathManager.getSystemPath(), "oxp", "store")
        CapabilityHandlers.register(LoadedExtension(
            instanceId = result.instanceId,
            extensionId = params.extensionId,
            permissions = params.permissions,
            hostStorePath = storeRoot,
        ))
        return result
    }

    suspend fun activate(instanceId: String) {
        val client = ensureStarted()
        client.request<InstanceRef, JsonElement>(
            "extension/activate", InstanceRef(instanceId))
    }

    suspend fun deactivate(instanceId: String) {
        val client = ensureStarted()
        client.request<InstanceRef, JsonElement>(
            "extension/deactivate", InstanceRef(instanceId))
    }

    suspend fun unload(instanceId: String) {
        val client = ensureStarted()
        client.notify("extension/unload", InstanceRef(instanceId))
        instances.remove(instanceId)
        CapabilityHandlers.unregister(instanceId)
    }

    suspend fun command(instanceId: String, commandId: String, argsJson: String): String {
        val client = ensureStarted()
        return client.request<CommandParams, CommandResult>(
            "extension/command",
            CommandParams(instanceId, commandId, argsJson),
        ).resultJson
    }

    fun launch(block: suspend CoroutineScope.() -> Unit) {
        scope.launch(block = block)
    }

    /**
     * Push a UI event (click/input/submit) back into a wasm component's
     * `ui-handler.on-event`. Fire-and-forget: the runtime forwards the
     * payload bytes verbatim.
     */
    fun sendEvent(instanceId: String, payload: JsonElement) {
        val client = rpc ?: return
        val params = buildJsonObject {
            put("instanceId", instanceId)
            put("payload", payload.toString())
        }
        client.notifyRaw("extension/event", params)
    }

    fun installAndActivate(project: Project?, params: LoadParams) {
        scope.launch {
            try {
                val loaded = load(params)
                activate(loaded.instanceId)
                notify(project, "Activated ${params.extensionId} (${loaded.instanceId})",
                    NotificationType.INFORMATION)
            } catch (e: Exception) {
                log.warn("install failed for ${params.extensionId}", e)
                notify(project, "OXP install failed: ${e.message}", NotificationType.ERROR)
            }
        }
    }

    fun status(): RuntimeStatus = RuntimeStatus(
        running = process?.isAlive == true,
        pid = process?.pid(),
        runtimeVersion = initResult?.runtimeVersion,
        wasmEngine = initResult?.wasmEngine,
        instances = instances.keys.toList(),
    )

    private fun handleNotification(method: String, params: JsonElement?) {
        when (method) {
            "ui/render" -> {
                val obj = (params as? JsonObject) ?: return
                val ev = UiRenderEvent(
                    instanceId  = obj["instanceId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    extensionId = obj["extensionId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    treeJson    = obj["treeJson"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                )
                if (ev.treeJson.isEmpty()) return
                uiRenderListeners.forEach { runCatching { it(ev) } }
            }
            "ui/setStatus" -> {
                val obj = (params as? JsonObject) ?: return
                val ev = UiStatusEvent(
                    instanceId  = obj["instanceId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    extensionId = obj["extensionId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    text        = obj["text"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    tooltip     = obj["tooltip"]?.jsonPrimitive?.contentOrNull,
                )
                uiStatusListeners.forEach { runCatching { it(ev) } }
            }
            "log/write" -> {
                val obj = (params as? JsonObject) ?: return
                CapabilityHandlers.handleNotification(method, obj)
            }
            "stream/data", "stream/open", "stream/close", "surface/render", "surface/ack" -> Unit
            else -> log.debug("ignoring notification: $method")
        }
    }

    private fun handleRequest(method: String, params: JsonElement?): JsonElement {
        val obj = (params as? JsonObject) ?: buildJsonObject { }
        // ui/notify is the one capability request that needs IDE-thread
        // interaction (modal dialog), so we route it locally rather than
        // through CapabilityHandlers which is pure data-plane.
        if (method == "ui/notify") return handleUiNotify(obj)
        return CapabilityHandlers.handleRequest(method, obj)
    }

    /**
     * Show a modal IDE notification with optional action buttons. Returns
     * `{choice: <label>|null}`. Marshals to EDT — caller is on IO scope.
     */
    private fun handleUiNotify(params: JsonObject): JsonElement {
        val message = params["message"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val level   = params["level"]?.jsonPrimitive?.contentOrNull ?: "info"
        val actions = params["actions"]?.let { it as? kotlinx.serialization.json.JsonArray }
            ?.mapNotNull { it.jsonPrimitive.contentOrNull }
            ?: emptyList()
        // Fan listeners so the existing render side can react too.
        val instId = params["instanceId"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val extId  = params["extensionId"]?.jsonPrimitive?.contentOrNull.orEmpty()
        uiNotifyListeners.forEach { runCatching { it(UiNotifyEvent(instId, extId, message)) } }

        val choice: String? = if (actions.isEmpty()) {
            // Plain notification — never returns a choice.
            val type = when (level) {
                "error" -> NotificationType.ERROR
                "warn"  -> NotificationType.WARNING
                else    -> NotificationType.INFORMATION
            }
            NotificationGroupManager.getInstance()
                .getNotificationGroup("OXP")
                .createNotification(message, type)
                .notify(null)
            null
        } else {
            val resultRef = arrayOfNulls<String>(1)
            com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
                val idx = com.intellij.openapi.ui.Messages.showDialog(
                    /* message = */ message,
                    /* title   = */ "OXP — $extId",
                    /* options = */ actions.toTypedArray(),
                    /* defaultOptionIndex = */ 0,
                    /* icon = */ null,
                )
                resultRef[0] = if (idx >= 0 && idx < actions.size) actions[idx] else null
            }
            resultRef[0]
        }
        return buildJsonObject {
            if (choice == null) put("choice", kotlinx.serialization.json.JsonNull)
            else put("choice", choice)
        }
    }

    private fun notify(project: Project?, content: String, type: NotificationType) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("OXP")
            .createNotification(content, type)
            .notify(project)
    }

    override fun dispose() {
        runCatching {
            runBlocking {
                rpc?.let { client ->
                    runCatching {
                        client.request<Unit, JsonElement>(
                            "shutdown", Unit, kotlin.time.Duration.parse("2s"))
                    }
                    client.notifyRaw("exit", null)
                }
            }
        }
        rpc?.stop()
        rpc = null
        process?.let { p ->
            // Close stdin so the runtime's reader loop hits EOF and exits
            // cleanly. Without this `exit` is queued but the loop blocks on
            // the next read.
            runCatching { p.outputStream.close() }
            if (p.isAlive) {
                if (!p.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                    p.destroy()
                    if (!p.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) p.destroyForcibly()
                }
            }
        }
        process = null
        scope.cancel()
    }

    private fun osPart() = when (OS.CURRENT) {
        OS.macOS -> "macos"
        OS.Linux -> "linux"
        OS.Windows -> "windows"
        else -> "unknown"
    }

    private fun archPart() = when (CpuArch.CURRENT) {
        CpuArch.ARM64 -> "aarch64"
        CpuArch.X86_64 -> "x86_64"
        else -> "unknown"
    }

    data class RuntimeStatus(
        val running: Boolean,
        val pid: Long?,
        val runtimeVersion: String?,
        val wasmEngine: String?,
        val instances: List<String>,
    )

    /** Notification payloads forwarded to UI listeners. */
    data class UiRenderEvent(val instanceId: String, val extensionId: String, val treeJson: String)
    data class UiStatusEvent(val instanceId: String, val extensionId: String, val text: String, val tooltip: String?)
    data class UiNotifyEvent(val instanceId: String, val extensionId: String, val message: String)

    companion object {
        @JvmStatic fun getInstance(): OxpRuntimeService = service()
    }
}
