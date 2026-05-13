package dev.oxp.jetbrains.ui

import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.JBUI
import dev.oxp.jetbrains.host.CapabilityHandlers
import dev.oxp.jetbrains.host.LoadedExtension
import dev.oxp.jetbrains.runtime.InstalledStoreReader
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import java.nio.file.Files
import java.nio.file.Path
import javax.swing.BorderFactory
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea

/**
 * Shared factory for rendering OXP extension UIs in JCEF browsers.
 * Used by both InstalledExtensionsPanel (tabs) and ExtensionToolWindowManager
 * (native tool windows) so bridge wiring is not duplicated.
 */
object ExtensionBrowserPanel {

    fun create(entry: InstalledStoreReader.Entry): JPanel {
        val main = entry.manifest.mainUi
        if (main != null) {
            val htmlPath = entry.installDir.resolve(main)
            if (JBCefApp.isSupported() && Files.isRegularFile(htmlPath)) {
                return createJcefPanel(entry, htmlPath)
            }
        }
        return createFallbackPanel(entry)
    }

    private fun createJcefPanel(entry: InstalledStoreReader.Entry, htmlPath: Path): JPanel {
        val browser = JBCefBrowser.createBuilder().setOffScreenRendering(false).build()

        val permissions = entry.manifest.raw["permissions"]
            ?.let { perm ->
                try { perm.jsonArray.map { it.jsonPrimitive.content } }
                catch (_: Exception) { emptyList() }
            } ?: emptyList()

        val instanceId = "ui-v1:${entry.manifest.id}"
        val oxpHome = InstalledStoreReader.defaultOxpHome()
        CapabilityHandlers.register(
            LoadedExtension(
                instanceId = instanceId,
                extensionId = entry.manifest.id,
                permissions = permissions,
                hostStorePath = oxpHome.resolve("host-store"),
            )
        )

        val jsQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

        jsQuery.addHandler { request: String ->
            try {
                val json = Json { ignoreUnknownKeys = true }
                val msg = json.parseToJsonElement(request).jsonObject
                if (msg["type"]?.jsonPrimitive?.contentOrNull != "oxp:request") {
                    return@addHandler JBCefJSQuery.Response(null, 0, "not an oxp request")
                }
                val id = msg["id"]?.jsonPrimitive?.content ?: "0"
                val method = msg["method"]?.jsonPrimitive?.contentOrNull ?: ""
                val params = msg["params"]?.jsonObject ?: JsonObject(emptyMap())

                val paramsWithInstance = buildJsonObject {
                    params.forEach { (k, v) -> put(k, v) }
                    put("instanceId", instanceId)
                }
                val result = CapabilityHandlers.handleRequest(method, paramsWithInstance)
                val response = buildJsonObject {
                    put("type", "oxp:response")
                    put("id", JsonPrimitive(id.toIntOrNull() ?: 0))
                    put("result", result)
                }
                JBCefJSQuery.Response(response.toString())
            } catch (e: dev.oxp.jetbrains.protocol.RpcException) {
                val id = extractId(request)
                JBCefJSQuery.Response(errorResponse(id, e.error.message).toString())
            } catch (e: Exception) {
                val id = extractId(request)
                JBCefJSQuery.Response(errorResponse(id, e.message ?: "unknown error").toString())
            }
        }

        val bridgeJs = loadBridgeJs()

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (frame == null || !frame.isMain) return
                frame.executeJavaScript(
                    """
                    window.__oxp_extension_id = '${entry.manifest.id.replace("'", "\\'")}';
                    window.__oxp_extension_version = '${entry.manifest.version.replace("'", "\\'")}';
                    """.trimIndent(), "", 0
                )
                frame.executeJavaScript(
                    "window.__oxp_host_postMessage = function(json) { ${jsQuery.inject("json")} };",
                    "", 0
                )
                frame.executeJavaScript(bridgeJs, "oxp-bridge.js", 0)
            }
        }, browser.cefBrowser)

        browser.loadURL(htmlPath.toUri().toString())

        val wrap = JPanel(BorderLayout())
        wrap.add(browser.component, BorderLayout.CENTER)
        return wrap
    }

    private fun createFallbackPanel(entry: InstalledStoreReader.Entry): JPanel {
        val p = JPanel(BorderLayout())
        p.border = BorderFactory.createTitledBorder("${entry.manifest.id}@${entry.manifest.version}")
        val text = buildString {
            appendLine(entry.manifest.displayName ?: entry.manifest.id)
            entry.manifest.description?.let { appendLine(it) }
            appendLine()
            appendLine("Kind: ${entry.kind}")
            appendLine("Path: ${entry.installDir}")
            if (!JBCefApp.isSupported()) {
                appendLine()
                appendLine("JCEF is not available — enable it via")
                appendLine("Help → Find Action → 'Choose Boot Java Runtime…'")
                appendLine("and select a JBR with JCEF.")
            }
        }
        val area = JTextArea(text).apply {
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
            border = JBUI.Borders.empty(8)
        }
        p.add(JScrollPane(area), BorderLayout.CENTER)
        return p
    }

    private fun loadBridgeJs(): String {
        val resource = ExtensionBrowserPanel::class.java.getResourceAsStream("/oxp-bridge.js")
        if (resource != null) return resource.bufferedReader().readText()
        val sdkBridge = Path.of(
            System.getProperty("user.home"), "Developer", "OXP", "oxp",
            "packages", "sdk", "dist", "oxp-bridge.js"
        )
        if (Files.isRegularFile(sdkBridge)) return Files.readString(sdkBridge)
        return "console.warn('OXP bridge not found — oxp.* APIs unavailable');"
    }

    private fun extractId(request: String): String = try {
        Json.parseToJsonElement(request).jsonObject["id"]?.jsonPrimitive?.content ?: "0"
    } catch (_: Exception) { "0" }

    private fun errorResponse(id: String, message: String) = buildJsonObject {
        put("type", "oxp:response")
        put("id", JsonPrimitive(id.toIntOrNull() ?: 0))
        put("error", message)
    }
}
