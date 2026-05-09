package dev.oxp.jetbrains.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * JSON-RPC 2.0 wire types for the OXP host ↔ runtime channel.
 * See `spec/v1/host-runtime-rpc.md`.
 *
 * A single envelope class covers requests, responses, and notifications:
 *  - request:      id != null, method != null
 *  - response:     id != null, method == null, result xor error
 *  - notification: id == null, method != null
 */
@Serializable
data class JsonRpcMessage(
    val jsonrpc: String = "2.0",
    val id: Long? = null,
    val method: String? = null,
    val params: JsonElement? = null,
    val result: JsonElement? = null,
    val error: JsonRpcError? = null,
)

@Serializable
data class JsonRpcError(
    val code: Int,
    val message: String,
    val data: JsonElement? = null,
)

// ── initialize ────────────────────────────────────────────────────────

@Serializable
data class InitializeParams(
    val protocolVersion: String,
    val host: HostInfo,
    val capabilities: JsonObject,
    val hostStorePath: String,
)

@Serializable
data class HostInfo(
    val id: String,
    val version: String,
    val platform: String,
)

@Serializable
data class InitializeResult(
    val runtimeVersion: String,
    val wasmEngine: String,
    val supportedSurfaces: List<String> = emptyList(),
)

// ── extension/load ─────────────────────────────────────────────────────

@Serializable
data class LoadParams(
    val extensionId: String,
    val version: String,
    val bundlePath: String,
    val permissions: List<String> = emptyList(),
    val surfacesRequired: List<String> = emptyList(),
    val surfacesOptional: List<String> = emptyList(),
)

@Serializable
data class LoadResult(
    val instanceId: String,
    val exports: List<String> = emptyList(),
    val degraded: List<String> = emptyList(),
)

@Serializable
data class InstanceRef(val instanceId: String)

@Serializable
data class CommandParams(
    val instanceId: String,
    val commandId: String,
    val argsJson: String,
)

@Serializable
data class CommandResult(val resultJson: String)
