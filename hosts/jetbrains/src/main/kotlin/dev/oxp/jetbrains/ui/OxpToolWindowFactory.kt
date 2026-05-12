package dev.oxp.jetbrains.ui

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import dev.oxp.jetbrains.protocol.LoadParams
import dev.oxp.jetbrains.runtime.BundleFetcher
import dev.oxp.jetbrains.runtime.FetchBundleException
import dev.oxp.jetbrains.runtime.OxpRuntimeService
import dev.oxp.jetbrains.runtime.UrlInstallRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.JTextArea
import javax.swing.SwingUtilities

/**
 * Visible OXP control panel inside any JetBrains IDE. Shows runtime status,
 * loaded extensions, and a tiny REPL that sends `hello.greet` and prints
 * the wasm-returned string. This is the human-facing proof that the runtime
 * is actually doing something.
 */
class OxpToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // "Installed" tab — first thing the user sees. Lists everything
        // already in `~/.oxp/host-store/extensions/` so a CLI install
        // is immediately discoverable.
        val installedPanel = InstalledExtensionsPanel(project, toolWindow)
        val installedContent = toolWindow.contentManager.factory
            .createContent(installedPanel, "Installed", false)
        installedContent.isCloseable = false
        toolWindow.contentManager.addContent(installedContent)

        // Tail `~/.oxp/notify/inbox.jsonl` so `oxp install` from any
        // terminal pops the extension open without the user clicking.
        val notifyWatcher = dev.oxp.jetbrains.runtime.NotifyInboxWatcher()
        val unsubscribeNotifyInbox = notifyWatcher.addListener { ev ->
            when (ev.kind) {
                "installed", "updated" -> ev.id?.let { installedPanel.openById(it) }
                "uninstalled" -> installedPanel.refresh()
            }
        }
        notifyWatcher.start()
        com.intellij.openapi.util.Disposer.register(toolWindow.disposable) {
            unsubscribeNotifyInbox()
            notifyWatcher.dispose()
        }

        // Auto-open all installed ui-v1 extensions as tabs so the user
        // sees their extensions immediately without double-clicking.
        SwingUtilities.invokeLater {
            val entries = try { dev.oxp.jetbrains.runtime.InstalledStoreReader.list() } catch (_: Exception) { emptyList() }
            for (entry in entries) {
                if (entry.manifest.mainUi != null) {
                    installedPanel.openById(entry.manifest.id)
                }
            }
            // Focus the first extension tab (skip "Installed" at index 0)
            if (toolWindow.contentManager.contentCount > 1) {
                toolWindow.contentManager.setSelectedContent(
                    toolWindow.contentManager.getContent(1)!!
                )
            }
        }

        // Surface extension-driven UI trees as additional tabs in this
        // tool window. One tab per instance; subsequent renders replace
        // the existing tab's component.
        val service = OxpRuntimeService.getInstance()
        val tabs = mutableMapOf<String, com.intellij.ui.content.Content>()
        val unsubscribeRender = service.addUiRenderListener { ev ->
            SwingUtilities.invokeLater {
                val rendered = UiTreeRenderer.build(ev.treeJson, ev.instanceId, service)
                val title = ev.extensionId.ifEmpty { ev.instanceId }
                val existing = tabs[ev.instanceId]
                if (existing != null) {
                    existing.component = rendered
                    existing.displayName = title
                } else {
                    val c = toolWindow.contentManager.factory.createContent(rendered, title, false)
                    toolWindow.contentManager.addContent(c)
                    tabs[ev.instanceId] = c
                }
            }
        }
        val unsubscribeNotify = service.addUiNotifyListener { ev ->
            NotificationGroupManager.getInstance().getNotificationGroup("OXP")
                .createNotification("[${ev.extensionId}] ${ev.message}", NotificationType.INFORMATION)
                .notify(project)
        }
        com.intellij.openapi.util.Disposer.register(toolWindow.disposable) {
            unsubscribeRender()
            unsubscribeNotify()
        }
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}

private class OxpPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val service = OxpRuntimeService.getInstance()

    private val statusLabel = JBLabel("Runtime: not started").apply {
        border = JBUI.Borders.empty(8)
    }
    private val instancesModel = DefaultListModel<String>()
    private val instancesList = JBList(instancesModel).apply {
        emptyText.text = "no extensions loaded"
    }
    private val instanceField = JBTextField()
    private val nameField = JBTextField("world")
    private val outputArea = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        background = JBColor.background()
        font = UIUtil.getLabelFont()
    }

    init {
        border = JBUI.Borders.empty(4)
        add(buildHeader(), BorderLayout.NORTH)
        add(buildCenter(), BorderLayout.CENTER)
        add(buildFooter(), BorderLayout.SOUTH)
        refreshStatus()
    }

    private fun buildHeader(): JPanel {
        val p = JPanel(BorderLayout())
        p.add(statusLabel, BorderLayout.CENTER)
        val refresh = JButton("Refresh").apply { addActionListener { refreshStatus() } }
        val start = JButton("Start runtime").apply {
            addActionListener {
                appendOut("→ starting runtime…")
                service.launch {
                    try {
                        service.ensureStarted()
                        SwingUtilities.invokeLater {
                            appendOut("✓ runtime ready")
                            refreshStatus()
                        }
                    } catch (e: Exception) {
                        SwingUtilities.invokeLater { appendOut("✗ start failed: ${e.message}") }
                    }
                }
            }
        }
        val controls = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            add(start); add(Box.createHorizontalStrut(4)); add(refresh)
        }
        p.add(controls, BorderLayout.EAST)
        return p
    }

    private fun buildCenter(): JPanel {
        val center = JPanel(BorderLayout())
        center.border = BorderFactory.createTitledBorder("Loaded extensions")
        center.add(JBScrollPane(instancesList), BorderLayout.CENTER)
        instancesList.addListSelectionListener {
            instancesList.selectedValue?.let { instanceField.text = it }
        }
        return center
    }

    private fun buildFooter(): JPanel {
        val p = JPanel(GridBagLayout())
        p.border = BorderFactory.createTitledBorder("Run hello.greet")
        val gc = GridBagConstraints().apply {
            fill = GridBagConstraints.HORIZONTAL
            insets = Insets(2, 4, 2, 4)
            gridx = 0; gridy = 0
        }
        p.add(JBLabel("Install:"), gc)
        gc.gridx = 1; gc.weightx = 1.0
        val installRow = javax.swing.JPanel().apply {
            layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.X_AXIS)
            add(JButton("Choose .wasm…").apply { addActionListener { installBundle() } })
            add(javax.swing.Box.createHorizontalStrut(6))
            add(JButton("From URL…").apply { addActionListener { installFromUrl() } })
            add(javax.swing.Box.createHorizontalStrut(6))
            add(JButton("From CLI…").apply { addActionListener { pickFromCli() } })
        }
        p.add(installRow, gc)

        gc.gridx = 0; gc.gridy = 1; gc.weightx = 0.0
        p.add(JBLabel("Instance:"), gc)
        gc.gridx = 1; gc.weightx = 1.0
        p.add(instanceField, gc)

        gc.gridx = 0; gc.gridy = 2; gc.weightx = 0.0
        p.add(JBLabel("name arg:"), gc)
        gc.gridx = 1; gc.weightx = 1.0
        p.add(nameField, gc)

        gc.gridx = 0; gc.gridy = 3; gc.weightx = 0.0; gc.gridwidth = 2
        val runBtn = JButton("Send hello.greet").apply {
            addActionListener { runGreet() }
        }
        p.add(runBtn, gc)

        gc.gridy = 4; gc.fill = GridBagConstraints.BOTH; gc.weighty = 1.0
        p.add(JBScrollPane(outputArea), gc)
        return p
    }

    private fun installBundle() {
        // Accept either a .wasm file directly or a directory containing one.
        val descriptor = FileChooserDescriptor(true, true, false, false, false, false)
            .withTitle("Select OXP extension bundle")
            .withDescription("Choose a .wasm component or a bundle directory")
        val file = FileChooser.chooseFile(descriptor, project, null) ?: return
        loadAndActivate(file.path, "@local/${file.nameWithoutExtension}", file.path)
    }

    private fun installFromUrl() {
        val raw = com.intellij.openapi.ui.Messages.showInputDialog(
            project,
            "Paste an https:// (or file://) URL to a .wasm component.\nhttp:// is allowed for localhost only.",
            "Install OXP extension from URL",
            null,
            "",
            object : com.intellij.openapi.ui.InputValidator {
                override fun checkInput(s: String?) = !s.isNullOrBlank() && runCatching { java.net.URI(s) }.isSuccess
                override fun canClose(s: String?) = checkInput(s)
            },
        ) ?: return
        val uri = try { java.net.URI(raw) } catch (e: Exception) {
            appendOut("✗ bad URL: ${e.message}"); return
        }
        val allowInsecureHttp = uri.scheme.equals("http", true) &&
            (uri.host == "localhost" || uri.host == "127.0.0.1" || uri.host == "::1")
        val cacheDir = java.nio.file.Path.of(
            System.getProperty("user.home"), ".oxp", "cache", "url-installs")

        appendOut("↓ downloading $raw …")
        service.launch {
            try {
                val fetched = withContext(Dispatchers.IO) {
                    BundleFetcher.fetch(raw, cacheDir, allowInsecureHttp = allowInsecureHttp)
                }
                SwingUtilities.invokeLater {
                    appendOut("↓ ${fetched.size} bytes, sha256 ${fetched.sha256.take(12)}…")
                }
                val name = uri.path.substringAfterLast('/').removeSuffix(".wasm").ifBlank { "remote" }
                loadAndActivate(fetched.componentPath.toString(), "@url/$name", raw)
            } catch (e: FetchBundleException) {
                SwingUtilities.invokeLater { appendOut("✗ download failed (${e.code}): ${e.message}") }
            } catch (e: Exception) {
                SwingUtilities.invokeLater { appendOut("✗ download failed: ${e.message}") }
            }
        }
    }

    /**
     * Browse extensions previously installed by the `oxp install-url` CLI
     * and stored under `<oxpHome>/host-store/url-installs/`. Picks one and
     * runs it through the standard permission-prompt + activate flow.
     */
    private fun pickFromCli() {
        val oxpHome = java.nio.file.Path.of(
            System.getenv("OXP_HOME")?.takeIf { it.isNotBlank() }
                ?: java.nio.file.Path.of(System.getProperty("user.home"), ".oxp").toString()
        )
        val entries = UrlInstallRegistry.list(oxpHome)
        if (entries.isEmpty()) {
            com.intellij.openapi.ui.Messages.showInfoMessage(
                project,
                "No URL installs found.\n\nRun `oxp install-url <https://…wasm>` from a terminal,\nthen open this picker again.",
                "OXP — From CLI",
            )
            return
        }
        val labels = entries.map { e ->
            "${e.meta.suggestedId}   (${e.meta.sha256.take(12)}…  ${e.meta.size}b)\n    ← ${e.meta.sourceUrl}"
        }
        // `Messages.showChooseDialog` is deprecated. The official replacement
        // for a list picker is `JBPopupFactory` — it's async, but the caller
        // is already on the EDT so we just dispatch the activation from the
        // popup's `onChosen` callback.
        com.intellij.openapi.ui.popup.JBPopupFactory.getInstance()
            .createPopupChooserBuilder(labels)
            .setTitle("OXP — From CLI")
            .setItemChosenCallback { selected ->
                val idx = labels.indexOf(selected)
                if (idx < 0) return@setItemChosenCallback
                val pick = entries[idx]
                loadAndActivate(pick.bundlePath.toString(), pick.meta.suggestedId, pick.meta.sourceUrl)
            }
            .createPopup()
            .showCenteredInCurrentWindow(project)
    }

    /** Common install tail: prompt for permissions, load, activate. */
    private fun loadAndActivate(componentPath: String, extensionId: String, sourceLabel: String) {
        // PermissionPrompt opens a DialogWrapper → must run on EDT.
        // This is safe to call from any thread (including coroutine workers).
        val grants = com.intellij.openapi.application.ApplicationManager.getApplication()
            .let { app ->
                if (app.isDispatchThread) PermissionPrompt.show(project, extensionId)
                else {
                    val ref = java.util.concurrent.atomic.AtomicReference<List<String>?>()
                    app.invokeAndWait { ref.set(PermissionPrompt.show(project, extensionId)) }
                    ref.get()
                }
            }
        if (grants == null) {
            SwingUtilities.invokeLater { appendOut("✗ install cancelled (permissions declined)") }
            return
        }
        appendOut("→ loading $sourceLabel …" + if (grants.isNotEmpty()) " (granted: ${grants.joinToString()})" else " (no extra permissions)")
        service.launch {
            try {
                val loaded = withContext(Dispatchers.IO) {
                    service.load(LoadParams(
                        extensionId = extensionId,
                        version = "0.0.0",
                        bundlePath = componentPath,
                        permissions = grants,
                    ))
                }
                service.activate(loaded.instanceId)
                SwingUtilities.invokeLater {
                    appendOut("✓ activated ${loaded.instanceId}")
                    instanceField.text = loaded.instanceId
                    refreshStatus()
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater { appendOut("✗ load failed: ${e.message}") }
            }
        }
    }

    private fun runGreet() {
        val inst = instanceField.text.trim()
        if (inst.isEmpty()) { appendOut("✗ no instance — install one first"); return }
        val name = nameField.text.trim().ifEmpty { "world" }
        // Build args JSON manually — kotlinx.serialization for one field is overkill.
        val args = """{"name":"${name.replace("\\", "\\\\").replace("\"", "\\\"")}"}"""
        appendOut("→ $inst hello.greet $args")
        service.launch {
            try {
                val out = service.command(inst, "hello.greet", args)
                SwingUtilities.invokeLater { appendOut("← $out") }
            } catch (e: Exception) {
                SwingUtilities.invokeLater { appendOut("✗ command failed: ${e.message}") }
            }
        }
    }

    private fun refreshStatus() {
        val s = service.status()
        statusLabel.text = if (s.running) {
            "Runtime: ${s.runtimeVersion ?: "?"} · ${s.wasmEngine ?: "?"} · pid ${s.pid}"
        } else {
            "Runtime: not started"
        }
        instancesModel.clear()
        s.instances.forEach { instancesModel.addElement(it) }
    }

    private fun appendOut(line: String) {
        outputArea.append(line + "\n")
        outputArea.caretPosition = outputArea.document.length
    }
}
