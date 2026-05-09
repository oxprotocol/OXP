package dev.oxp.jetbrains.protocol

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Path
import java.util.concurrent.TimeUnit

/**
 * End-to-end test: launches the real `oxp-runtime` subprocess, drives it
 * through the full lifecycle (initialize → load → activate → command →
 * deactivate → unload → shutdown → exit) over the same JSON-RPC channel
 * the Kotlin plugin uses in production.
 *
 * No IntelliJ Platform classes are touched — this exercises the protocol
 * stack only (Framing + RpcClient + Protocol). Same shape as the Python
 * smoke (runtime/scripts/smoke_hello_rust.py) and the Lua smoke
 * (hosts/neovim/scripts/smoke_init.lua).
 *
 * Skipped automatically if either binary isn't built — keeps `gradle test`
 * green for contributors who haven't run cargo yet.
 */
class RuntimeIntegrationTest {

    private val repoRoot: Path = run {
        // hosts/jetbrains/build/classes/kotlin/test/.. → walk up to repo root
        var p: Path = File(System.getProperty("user.dir")).toPath()
        while (p.parent != null && !p.resolve("runtime/Cargo.toml").toFile().exists()) {
            p = p.parent
        }
        p
    }

    private val runtimeBinary: File =
        repoRoot.resolve("runtime/target/debug/oxp-runtime").toFile()

    private val helloWasm: File = repoRoot
        .resolve("examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm")
        .toFile()

    @Test
    fun `full lifecycle drives hello-rust component`() = runBlocking {
        org.junit.jupiter.api.Assumptions.assumeTrue(
            runtimeBinary.canExecute(),
            "oxp-runtime not built at $runtimeBinary — run scripts/stage-runtime.sh"
        )
        org.junit.jupiter.api.Assumptions.assumeTrue(
            helloWasm.exists(),
            "hello-rust.wasm not built at $helloWasm"
        )

        val pb = ProcessBuilder(runtimeBinary.absolutePath, "--host", "jetbrains-test")
            .redirectErrorStream(false)
        pb.environment()["OXP_LOG"] = "info"
        val proc = pb.start()

        // Pipe stderr to stdout so test failures include runtime tracing.
        val stderrPump = Thread({
            proc.errorStream.bufferedReader().forEachLine { println("[oxp-runtime] $it") }
        }, "stderr-pump").apply { isDaemon = true; start() }

        val notifications = mutableListOf<Pair<String, JsonElement?>>()
        val rpc = RpcClient(
            out = proc.outputStream,
            input = proc.inputStream,
            onNotification = { method, params ->
                synchronized(notifications) { notifications += method to params }
            },
        )
        rpc.start()

        try {
            // initialize
            val initParams = buildJsonObject {
                put("protocolVersion", "1.0")
                putJsonObject("host") {
                    put("id", "jetbrains-test")
                    put("version", "0.0.0")
                    put("platform", "test")
                }
                putJsonObject("capabilities") {
                    putJsonObject("ui") { put("statusBar", true); put("notification", true) }
                }
                put("hostStorePath", "/tmp/oxp-jetbrains-test")
            }
            val initResult = rpc.requestRaw(
                "initialize", initParams, kotlin.time.Duration.parse("10s"),
            ).jsonObject
            assertEquals("0.1.0", initResult["runtimeVersion"]?.jsonPrimitive?.content)
            assertTrue(
                initResult["wasmEngine"]?.jsonPrimitive?.content?.startsWith("wasmtime/") == true,
                "wasmEngine should report wasmtime/<v>, got ${initResult["wasmEngine"]}",
            )

            // extension/load
            val loadParams = buildJsonObject {
                put("extensionId", "@aldgar/hello")
                put("version", "0.1.0")
                put("bundlePath", helloWasm.absolutePath)
            }
            val loadResult = rpc.requestRaw(
                "extension/load", loadParams, kotlin.time.Duration.parse("10s"),
            ).jsonObject
            val instanceId = loadResult["instanceId"]?.jsonPrimitive?.content
                ?: error("missing instanceId in load result: $loadResult")
            assertTrue(instanceId.startsWith("ext-"), "instanceId format: $instanceId")

            // extension/activate — this is what triggers `oxp:host/log` from
            // inside the .wasm. If the runtime crashes or the import isn't
            // wired, this throws.
            rpc.requestRaw(
                "extension/activate",
                buildJsonObject { put("instanceId", instanceId) },
                kotlin.time.Duration.parse("10s"),
            )

            // extension/command
            val cmdResult = rpc.requestRaw(
                "extension/command",
                buildJsonObject {
                    put("instanceId", instanceId)
                    put("commandId", "hello.greet")
                    put("argsJson", JsonPrimitive("""{"name":"jetbrains"}""").content)
                },
                kotlin.time.Duration.parse("10s"),
            ).jsonObject
            val resultJson = cmdResult["resultJson"]?.jsonPrimitive?.content
            assertEquals("\"hello, jetbrains!\"", resultJson,
                "hello.greet should echo the name argument back from real wasm execution")

            // extension/deactivate
            rpc.requestRaw(
                "extension/deactivate",
                buildJsonObject { put("instanceId", instanceId) },
                kotlin.time.Duration.parse("10s"),
            )

            // extension/unload — notification, no response
            rpc.notifyRaw(
                "extension/unload",
                buildJsonObject { put("instanceId", instanceId) },
            )

            // shutdown + exit
            rpc.requestRaw("shutdown", null, kotlin.time.Duration.parse("5s"))
            rpc.notifyRaw("exit", null)
        } finally {
            rpc.stop()
            // Close stdin so the runtime's reader loop hits EOF and breaks
            // out of its select! — matches what runtime/scripts/smoke_hello_rust.py
            // does. Without this, the daemon's `should_exit` flag is set but
            // the loop is still blocked reading the next frame.
            runCatching { proc.outputStream.close() }
            if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                proc.destroyForcibly()
                error("oxp-runtime did not exit within 5s of `exit` notification")
            }
            stderrPump.join(1000)
        }

        assertEquals(0, proc.exitValue(), "oxp-runtime should exit cleanly")
    }
}
