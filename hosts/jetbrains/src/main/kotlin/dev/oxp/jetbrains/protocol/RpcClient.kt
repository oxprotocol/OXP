package dev.oxp.jetbrains.protocol

import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.serializer
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * JSON-RPC 2.0 client over arbitrary streams. Threading model:
 *   - All writes serialised through a single `synchronized(out)` block so
 *     two coroutines never interleave bytes on stdin.
 *   - One background thread blocks on `Framing.readFrame` and dispatches
 *     decoded messages onto the supplied coroutine scope.
 *   - Pending requests are tracked by id; responses complete the deferred.
 *
 * No EDT involvement here — that's the caller's job. RPC is pure I/O.
 */
class RpcClient(
    private val out: OutputStream,
    private val input: InputStream,
    private val onNotification: (method: String, params: JsonElement?) -> Unit,
    private val onRequest: (method: String, params: JsonElement?) -> JsonElement = { method, _ ->
        throw RpcException(JsonRpcError(-32601, "Method not found: $method"))
    },
) {
    private val log = Logger.getInstance(RpcClient::class.java)
    private val nextId = AtomicLong(1)
    private val pending = ConcurrentHashMap<Long, CompletableDeferred<JsonElement>>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var readerJob: Job? = null

    private val json = Json {
        ignoreUnknownKeys = true
        // `encodeDefaults = true` is required so the `jsonrpc: "2.0"` discriminator
        // (declared with a Kotlin default in JsonRpcMessage) is actually serialized.
        // JSON-RPC 2.0 requires the field on every message; without it the runtime
        // silently drops the frame.
        encodeDefaults = true
        explicitNulls = false
    }

    fun start() {
        readerJob = scope.launch { readerLoop() }
    }

    fun stop() {
        scope.cancel()
        pending.values.forEach { it.cancel() }
        pending.clear()
    }

    /** Send a request; suspends until the response arrives or times out. */
    suspend inline fun <reified P, reified R> request(
        method: String,
        params: P,
        timeout: Duration = 30.seconds,
    ): R {
        val paramsJson: JsonElement? = if (params == Unit) null
            else jsonEncoder.encodeToJsonElement(serializer<P>(), params)
        val resultJson = requestRaw(method, paramsJson, timeout)
        return jsonEncoder.decodeFromJsonElement(serializer<R>(), resultJson)
    }

    /** Public for the inline above — call [request] in user code. */
    @PublishedApi
    internal val jsonEncoder: Json get() = json

    suspend fun requestRaw(
        method: String,
        params: JsonElement?,
        timeout: Duration,
    ): JsonElement {
        val id = nextId.getAndIncrement()
        val deferred = CompletableDeferred<JsonElement>()
        pending[id] = deferred
        try {
            send(JsonRpcMessage(id = id, method = method, params = params))
            return withTimeout(timeout) { deferred.await() }
        } finally {
            pending.remove(id)
        }
    }

    inline fun <reified P> notify(method: String, params: P) {
        val paramsJson: JsonElement? = if (params == Unit) null
            else jsonEncoder.encodeToJsonElement(serializer<P>(), params)
        notifyRaw(method, paramsJson)
    }

    fun notifyRaw(method: String, params: JsonElement?) {
        send(JsonRpcMessage(method = method, params = params))
    }

    private fun send(msg: JsonRpcMessage) {
        val text = json.encodeToString(JsonRpcMessage.serializer(), msg)
        synchronized(out) { Framing.write(out, text) }
    }

    private suspend fun readerLoop() {
        try {
            while (true) {
                val text = try {
                    Framing.readFrame(input)
                } catch (e: Exception) {
                    log.warn("oxp-runtime stream error: ${e.message}")
                    return
                } ?: return
                val msg = try {
                    json.decodeFromString(JsonRpcMessage.serializer(), text)
                } catch (e: Exception) {
                    log.warn("malformed JSON-RPC frame: ${e.message}")
                    continue
                }
                dispatch(msg)
            }
        } finally {
            // Fail any in-flight requests so callers don't hang.
            pending.values.forEach {
                it.completeExceptionally(IllegalStateException("oxp-runtime channel closed"))
            }
        }
    }

    private fun dispatch(msg: JsonRpcMessage) {
        // Response to one of our requests.
        if (msg.id != null && msg.method == null) {
            val waiter = pending.remove(msg.id) ?: run {
                log.warn("response for unknown id ${msg.id}")
                return
            }
            if (msg.error != null) {
                waiter.completeExceptionally(RpcException(msg.error))
            } else {
                waiter.complete(msg.result ?: kotlinx.serialization.json.JsonNull)
            }
            return
        }
        // Inbound from runtime.
        if (msg.method != null) {
            if (msg.id == null) {
                runCatching { onNotification(msg.method, msg.params) }
                    .onFailure { log.warn("notification handler threw", it) }
            } else {
                scope.launch {
                    val response = try {
                        val result = onRequest(msg.method, msg.params)
                        JsonRpcMessage(id = msg.id, result = result)
                    } catch (e: RpcException) {
                        JsonRpcMessage(id = msg.id, error = e.error)
                    } catch (e: Throwable) {
                        JsonRpcMessage(id = msg.id,
                            error = JsonRpcError(-32603, "Internal error: ${e.message}"))
                    }
                    send(response)
                }
            }
        }
    }
}

class RpcException(val error: JsonRpcError) :
    RuntimeException("[${error.code}] ${error.message}")
