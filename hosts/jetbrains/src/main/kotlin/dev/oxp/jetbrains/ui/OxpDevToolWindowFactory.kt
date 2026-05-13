package dev.oxp.jetbrains.ui

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.JBUI
import dev.oxp.jetbrains.edh.OxpDevSession
import javax.swing.Icon
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Font
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingUtilities
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter

/**
 * Tool window that hosts the OXP Extension Development Host UI inside a
 * JCEF browser (the JetBrains equivalent of VS Code's WebviewView).
 *
 * Wiring: [dev.oxp.jetbrains.edh.EdhStartupActivity] attaches the
 * project-scoped [OxpDevSession] on project open if a marker matched.
 * This factory subscribes to that session and reloads the JCEF browser
 * pointed at `http://localhost:<port>/ui/<manifest.main.ui>` on every
 * `reload` message — the dev server serves project files directly so we
 * don't need to decompress the zstd bundle in the JVM.
 *
 * Falls back to a plain "JCEF unavailable" panel for IDE builds where
 * embedded Chromium isn't included.
 */
class OxpDevToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val content = if (JBCefApp.isSupported()) {
            DevPanel(project, toolWindow)
        } else {
            unsupportedPanel()
        }
        val tw = toolWindow.contentManager.factory.createContent(content, null, false)
        tw.isCloseable = false
        toolWindow.contentManager.addContent(tw)
    }

    override fun shouldBeAvailable(project: Project): Boolean = true

    private fun unsupportedPanel(): JComponent {
        val p = JPanel(BorderLayout())
        p.border = JBUI.Borders.empty(16)
        val label = JBLabel(
            "<html><b>JCEF is not available in this IDE build.</b><br/>" +
                "OXP Dev requires embedded Chromium. Enable it via " +
                "Registry: <code>ide.browser.jcef.enabled = true</code> and restart.</html>"
        )
        p.add(label, BorderLayout.NORTH)
        return p
    }
}

/**
 * The actual JCEF-backed Dev panel. Decoupled from the factory so the
 * unsupported branch stays minimal.
 */
private class DevPanel(
    private val project: Project,
    private val toolWindow: ToolWindow,
) : JPanel(BorderLayout()), com.intellij.openapi.Disposable {

    private val session: OxpDevSession = project.getService(OxpDevSession::class.java)
    private val browser: JBCefBrowser = JBCefBrowser.createBuilder()
        .setOffScreenRendering(false)
        .build()

    private val statusLabel = JBLabel("Idle — waiting for `oxp dev`…").apply {
        border = JBUI.Borders.empty(0, 8)
        font = font.deriveFont(Font.PLAIN)
    }
    private val badgeLabel = JBLabel("DEV").apply {
        foreground = Color.WHITE
        background = JBColor(Color(0x6D, 0x28, 0xD9), Color(0x6D, 0x28, 0xD9))
        isOpaque = true
        border = JBUI.Borders.empty(2, 8)
        font = font.deriveFont(Font.BOLD, 10f)
    }
    private val titleLabel = JBLabel("OXP Extension Development Host").apply {
        border = JBUI.Borders.empty(0, 8)
        font = font.deriveFont(Font.BOLD)
    }
    /** Tracks the most recent manifest icon URL we loaded so we don't
     *  re-fetch on every status update for the same extension. */
    private var lastIconUrl: String? = null

    private var unsubscribe: (() -> Unit)? = null
    private var lastLoadedUrl: String? = null

    /**
     * Round-trip channel from JS → Kotlin used by the dev error boundary.
     * The injected script calls `__oxpReportError(message, stack)` whose
     * body is the JS expression produced by `errorQuery.inject(...)`.
     */
    private val errorQuery: JBCefJSQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase)

    init {
        Disposer.register(toolWindow.disposable, this)
        Disposer.register(this, browser)
        Disposer.register(this, errorQuery)

        add(buildHeader(), BorderLayout.NORTH)
        add(browser.component, BorderLayout.CENTER)

        // ── Dev error boundary (parity with VS Code host) ────────────
        //
        // VS Code injects an in-page script into the bundled webview's
        // <head> that catches `window.onerror` and `unhandledrejection`,
        // renders a dismissable overlay, and postMessages the failure
        // back to the host. We can't splice <head> here because the
        // dev server (not us) owns the HTML — but JCEF lets us evaluate
        // a script on every page load via a CefLoadHandler, which runs
        // before the page's own scripts on `onLoadStart`.
        errorQuery.addHandler { json ->
            session.log("error", "extension runtime error: $json")
            null
        }
        browser.jbCefClient.addLoadHandler(
            object : CefLoadHandlerAdapter() {
                override fun onLoadStart(
                    cefBrowser: CefBrowser?,
                    frame: CefFrame?,
                    transitionType: org.cef.network.CefRequest.TransitionType?,
                ) {
                    // Only inject into the top frame — sub-frames either
                    // share `window` (they don't, in JCEF) or are out of
                    // scope for the extension's UI surface.
                    if (frame == null || !frame.isMain) return
                    // Theme bridge FIRST so the page's own scripts see
                    // the `--vscode-*` CSS variables on `getComputedStyle`
                    // synchronously during their initial render. The
                    // dev error boundary is fine to run after.
                    cefBrowser?.executeJavaScript(ThemeBridge.injectScript(), cefBrowser.url, 0)
                    cefBrowser?.executeJavaScript(devBoundaryScript(), cefBrowser.url, 0)
                }
            },
            browser.cefBrowser,
        )

        // Re-inject theme tokens when the user switches IDE LAF or the
        // editor color scheme — without this the webview keeps the
        // colors that were live at first load.
        val app = ApplicationManager.getApplication()
        val busConnection = app.messageBus.connect(this)
        busConnection.subscribe(
            com.intellij.ide.ui.LafManagerListener.TOPIC,
            com.intellij.ide.ui.LafManagerListener { reinjectTheme() },
        )
        busConnection.subscribe(
            com.intellij.openapi.editor.colors.EditorColorsManager.TOPIC,
            com.intellij.openapi.editor.colors.EditorColorsListener { reinjectTheme() },
        )

        // Load the empty-state HTML synchronously so the panel never
        // shows a blank Chromium frame.
        loadIdle("Waiting for `oxp dev`…")

        unsubscribe = session.addListener { status, reload ->
            SwingUtilities.invokeLater { onSessionUpdate(status, reload) }
        }
    }

    override fun dispose() {
        unsubscribe?.invoke()
        unsubscribe = null
    }

    /** Re-run the theme bridge script in the current document. Safe
     *  to call even before the page has loaded — the script no-ops
     *  until `document.documentElement` exists. */
    private fun reinjectTheme() {
        val url = browser.cefBrowser.url ?: return
        browser.cefBrowser.executeJavaScript(ThemeBridge.injectScript(), url, 0)
    }

    private fun buildHeader(): JComponent {
        val p = JPanel(BorderLayout())
        p.border = JBUI.Borders.customLineBottom(JBColor.border())
        val left = JPanel(BorderLayout())
        left.add(badgeLabel, BorderLayout.WEST)
        left.add(titleLabel, BorderLayout.CENTER)
        p.add(left, BorderLayout.WEST)
        p.add(statusLabel, BorderLayout.CENTER)

        // Right-side toolbar: Reload + Open DevTools.
        val group = DefaultActionGroup().apply {
            add(object : AnAction("Reload", "Reload the EDH browser", AllIcons.Actions.Refresh) {
                override fun actionPerformed(e: AnActionEvent) {
                    reloadBrowser()
                }
            })
            add(object : AnAction("Open DevTools", "Open Chromium devtools", AllIcons.Actions.StartDebugger) {
                override fun actionPerformed(e: AnActionEvent) {
                    browser.openDevtools()
                }
            })
        }
        val tb = ActionManager.getInstance()
            .createActionToolbar("OxpDev", group, true)
        tb.targetComponent = this
        p.add(tb.component, BorderLayout.EAST)
        return p
    }

    // ── Session callbacks (always on EDT) ────────────────────────────

    private fun onSessionUpdate(status: OxpDevSession.Status, reload: OxpDevSession.Reload?) {
        // Title label + icon: surface the manifest identity so users can
        // tell which extension this Dev panel is hosting at a glance.
        if (reload != null) {
            val tag = "${reload.id ?: "?"}@${reload.version ?: "?"}"
            titleLabel.text = tag
            updateIcon(reload.iconUrl)
        } else {
            titleLabel.text = "OXP Extension Development Host"
            updateIcon(null)
        }
        // Status label
        statusLabel.text = when (status) {
            is OxpDevSession.Status.Idle -> "Idle — waiting for `oxp dev`…"
            is OxpDevSession.Status.Connecting -> "Connecting to ${status.wsUrl}…"
            is OxpDevSession.Status.Connected -> {
                val tag = reload?.let { "${it.id ?: "?"}@${it.version ?: "?"}" }
                if (tag != null) "Connected — $tag" else "Connected — waiting for first build…"
            }
            is OxpDevSession.Status.Error -> "Error: ${status.message}"
            is OxpDevSession.Status.Disconnected -> "Disconnected from ${status.wsUrl}"
            is OxpDevSession.Status.Shutdown -> "Dev server stopped"
        }
        statusLabel.foreground = when (status) {
            is OxpDevSession.Status.Error -> JBColor(Color(0xDC, 0x60, 0x60), Color(0xF8, 0x71, 0x71))
            is OxpDevSession.Status.Connected -> JBColor(Color(0x16, 0x80, 0x50), Color(0x6E, 0xE7, 0xB7))
            else -> UIManagerForeground()
        }

        // Render or error overlay
        when (status) {
            is OxpDevSession.Status.Error -> loadError(status.message)
            is OxpDevSession.Status.Connecting -> loadIdle("Connecting to ${status.wsUrl}…")
            is OxpDevSession.Status.Disconnected -> loadIdle("Disconnected. Restart `oxp dev` to reattach.")
            is OxpDevSession.Status.Shutdown -> loadIdle("`oxp dev` stopped. This window will close.")
            else -> if (reload != null) maybeLoadReload(reload)
        }
    }

    private fun maybeLoadReload(r: OxpDevSession.Reload) {
        val ui = r.mainUi
        if (ui.isNullOrBlank()) {
            loadIdle("${r.id ?: "?"}@${r.version ?: "?"} — no main.ui (code-only extension)")
            return
        }
        val cacheBust = r.builtAt
        val url = "${r.httpBase}/ui/$ui?_oxp_t=$cacheBust"
        if (url == lastLoadedUrl) return
        lastLoadedUrl = url
        browser.loadURL(url)
    }

    private fun reloadBrowser() {
        val r = session.latestReload ?: return loadIdle("No build yet.")
        lastLoadedUrl = null
        maybeLoadReload(r)
    }

    // ── Empty-state HTML ─────────────────────────────────────────────

    private fun loadIdle(message: String) {
        lastLoadedUrl = null
        browser.loadHTML(emptyHtml(message, error = false))
    }

    private fun loadError(message: String) {
        lastLoadedUrl = null
        browser.loadHTML(emptyHtml(message, error = true))
    }

    private fun emptyHtml(message: String, error: Boolean): String {
        val safeMsg = escapeHtml(message)
        val body = if (error) {
            """
            <div class="card">
              <div class="err-icon">⚠</div>
              <div class="title">Something went wrong</div>
              <p class="desc err-desc">$safeMsg</p>
            </div>
            """.trimIndent()
        } else {
            """
            <div class="card">
              <div class="idle-icon">⚡</div>
              <div class="title">OXP Dev Mode</div>
              <p class="desc">$safeMsg</p>
              <p class="hint">Run <code>oxp dev</code> in your project terminal to connect.</p>
            </div>
            """.trimIndent()
        }
        return """
            <!doctype html>
            <html>
            <head><meta charset="utf-8"><style>
            *{box-sizing:border-box;margin:0;padding:0}
            body{
              font-family:var(--vscode-font-family,system-ui,-apple-system,sans-serif);
              background:var(--vscode-sideBar-background,#1e1e1e);
              color:var(--vscode-foreground,#cccccc);
              display:flex;align-items:center;justify-content:center;
              min-height:100vh;padding:24px;
            }
            .card{text-align:center;max-width:280px}
            .idle-icon{font-size:36px;margin-bottom:16px;opacity:.5}
            .err-icon{font-size:36px;margin-bottom:16px;color:#f87171}
            .title{font-size:14px;font-weight:600;margin-bottom:10px;
              color:var(--vscode-foreground,#cccccc)}
            .desc{font-size:12px;line-height:1.6;
              color:var(--vscode-descriptionForeground,#888)}
            .err-desc{color:#f87171}
            .hint{font-size:11px;margin-top:14px;
              color:var(--vscode-descriptionForeground,#666)}
            code{font-family:var(--vscode-editor-font-family,monospace);
              background:var(--vscode-textCodeBlock-background,#2a2a2a);
              padding:2px 5px;border-radius:3px;font-size:11px}
            </style></head>
            <body>$body</body>
            </html>
        """.trimIndent()
    }

    private fun UIManagerForeground(): Color =
        javax.swing.UIManager.getColor("Label.foreground") ?: JBColor.foreground()

    private fun escapeHtml(s: String): String =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    /**
     * Fetch the manifest icon (svg or png) from the dev server and apply
     * it to the title label. Kept off-EDT for the network call; the
     * Swing mutation hops back via invokeLater. Failures are silent —
     * the title text alone is enough to identify the extension.
     */
    private fun updateIcon(iconUrl: String?) {
        if (iconUrl == lastIconUrl) return
        lastIconUrl = iconUrl
        if (iconUrl == null) {
            titleLabel.icon = null
            return
        }
        val bg = ApplicationManager.getApplication()
        bg.executeOnPooledThread {
            val icon: Icon? = runCatching { loadIconFromUrl(iconUrl) }.getOrNull()
            SwingUtilities.invokeLater {
                if (lastIconUrl == iconUrl) titleLabel.icon = icon
            }
        }
    }

    /**
     * Decode a PNG byte stream into a 16×16 Swing Icon. SVG isn't
     * supported here because the IntelliJ Platform's SVG decoder
     * (`com.intellij.util.SVGLoader`) is `@ApiStatus.Internal`, and
     * pulling Batik just for icon rendering is overkill. Authors who
     * want their icon visible in the JetBrains host should ship a PNG
     * (the manifest schema already permits both `.svg` and `.png`).
     */
    private fun loadIconFromUrl(url: String): Icon? {
        if (url.endsWith(".svg", ignoreCase = true)) return null
        val bytes = java.net.URI(url).toURL().openStream().use { it.readBytes() }
        val img = javax.imageio.ImageIO.read(bytes.inputStream()) ?: return null
        return com.intellij.util.IconUtil.toSize(javax.swing.ImageIcon(img), 16, 16)
    }

    /**
     * In-page error boundary, evaluated on every top-frame load.
     *
     * Mirrors the script the VS Code host splices into the webview's
     * <head>: catches uncaught errors and unhandled promise rejections,
     * shows a dark themed overlay with a close button, and pipes the
     * failure back to the IDE via [errorQuery] so it lands in the OXP
     * Dev log alongside the other session events.
     *
     * Idempotent: a flag on `window` short-circuits re-installation if
     * onLoadStart fires more than once for the same document.
     */
    private fun devBoundaryScript(): String {
        // `errorQuery.inject(jsExpr)` returns a JS call that delivers
        // `jsExpr` (a String, evaluated in-page) to our Kotlin handler.
        val deliver = errorQuery.inject(
            "JSON.stringify({message:String(message||''),stack:String(stack||'')})",
        )
        return """
(function () {
  if (window.__oxpDevBoundaryInstalled) return;
  window.__oxpDevBoundaryInstalled = true;

  var overlay = null;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = '__oxp_dev_err__';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;' +
      'background:rgba(15,17,23,0.96);color:#e8e8e8;' +
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'font-size:12px;line-height:1.45;padding:16px;overflow:auto;' +
      'display:none;border-left:3px solid #f87171';
    overlay.innerHTML =
      '<div style="display:flex;justify-content:space-between;' +
      'align-items:center;margin-bottom:8px">' +
      '<strong style="color:#f87171;font-size:13px">' +
      '\u26a0 Extension runtime error</strong>' +
      '<button type="button" id="__oxp_dev_err_close__" ' +
      'style="background:transparent;border:1px solid #3f3f46;' +
      'color:#e8e8e8;border-radius:3px;padding:2px 8px;' +
      'cursor:pointer;font:inherit">close</button></div>' +
      '<div id="__oxp_dev_err_msg__" style="color:#f87171;' +
      'white-space:pre-wrap;margin-bottom:8px"></div>' +
      '<pre id="__oxp_dev_err_stack__" style="white-space:pre-wrap;' +
      'color:#a1a1aa;margin:0"></pre>';
    function appendWhenReady() {
      if (document.body) {
        document.body.appendChild(overlay);
        var btn = document.getElementById('__oxp_dev_err_close__');
        if (btn) btn.addEventListener('click', function () {
          overlay.style.display = 'none';
        });
      } else {
        document.addEventListener('DOMContentLoaded', appendWhenReady, { once: true });
      }
    }
    appendWhenReady();
    return overlay;
  }

  function report(message, stack) {
    var el = ensureOverlay();
    var m = document.getElementById('__oxp_dev_err_msg__');
    var s = document.getElementById('__oxp_dev_err_stack__');
    if (m) m.textContent = String(message || 'Unknown error');
    if (s) s.textContent = String(stack || '');
    if (el) el.style.display = 'block';
    try { $deliver } catch (_) {}
  }

  window.addEventListener('error', function (e) {
    var err = e && e.error;
    report((err && err.message) || e.message, (err && err.stack) || '');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var msg = (r && r.message) || (typeof r === 'string' ? r : 'Unhandled promise rejection');
    var stack = (r && r.stack) || '';
    report(msg, stack);
  });
})();
        """.trimIndent()
    }
}
