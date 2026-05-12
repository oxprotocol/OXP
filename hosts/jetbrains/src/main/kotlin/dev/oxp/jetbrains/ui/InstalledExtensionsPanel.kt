package dev.oxp.jetbrains.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.Content
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import dev.oxp.jetbrains.runtime.InstalledStoreReader
import dev.oxp.jetbrains.runtime.NotifyInboxWatcher
import java.awt.BorderLayout
import java.awt.Component
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingUtilities

/**
 * The "Installed" tab inside the OXP tool window. Lists everything in
 * `~/.oxp/host-store/extensions/` so a `oxp install @x/y` from any
 * terminal is immediately visible inside the IDE. Double-click an entry
 * to open its UI in a new tab.
 *
 * Auto-refreshes on every `installed`/`updated`/`uninstalled` event from
 * the CLI broadcast inbox.
 */
internal class InstalledExtensionsPanel(
    private val project: Project,
    private val toolWindow: ToolWindow,
) : JPanel(BorderLayout()) {

    private val listModel = DefaultListModel<InstalledStoreReader.Entry>()
    private val list = JBList(listModel).apply {
        cellRenderer = EntryCellRenderer()
        emptyText.text = "No extensions installed yet"
        emptyText.appendLine("Run `oxp install @publisher/slug` in a terminal.")
    }
    private val tabs = mutableMapOf<String, Content>()

    init {
        border = JBUI.Borders.empty(4)
        add(buildHeader(), BorderLayout.NORTH)
        add(JBScrollPane(list), BorderLayout.CENTER)

        list.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount >= 2) {
                    list.selectedValue?.let { openEntry(it) }
                }
            }
        })

        refresh()
    }

    private fun buildHeader(): JPanel {
        val p = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            border = JBUI.Borders.empty(4, 2)
        }
        p.add(JBLabel("Installed extensions").apply {
            border = JBUI.Borders.emptyRight(8)
        })
        p.add(Box.createHorizontalGlue())
        p.add(JButton("Open").apply { addActionListener {
            list.selectedValue?.let { openEntry(it) }
        }})
        p.add(Box.createHorizontalStrut(4))
        p.add(JButton("Refresh").apply { addActionListener { refresh() } })
        return p
    }

    /** Re-read `~/.oxp/host-store/extensions/` and update the list. */
    fun refresh() {
        val entries = try { InstalledStoreReader.list() } catch (_: Exception) { emptyList() }
        SwingUtilities.invokeLater {
            val previouslySelected = list.selectedValue?.manifest?.id
            listModel.clear()
            entries.forEach { listModel.addElement(it) }
            if (previouslySelected != null) {
                for (i in 0 until listModel.size()) {
                    if (listModel.getElementAt(i).manifest.id == previouslySelected) {
                        list.selectedIndex = i; break
                    }
                }
            }
        }
    }

    /**
     * Auto-open the just-installed extension. Called from the notify
     * watcher when `oxp install` finishes. Refreshes first, then opens.
     */
    fun openById(id: String) {
        refresh()
        ApplicationManager.getApplication().invokeLater {
            val entry = InstalledStoreReader.get(id) ?: return@invokeLater
            // Activate this tool window so the user actually sees the tab pop in.
            ToolWindowManager.getInstance(project).getToolWindow("OXP")?.activate(null, true)
            openEntry(entry)
        }
    }

    /** Open an extension's UI in a new tab (or focus the existing one). */
    private fun openEntry(entry: InstalledStoreReader.Entry) {
        val id = entry.manifest.id
        val existing = tabs[id]
        if (existing != null && toolWindow.contentManager.contents.contains(existing)) {
            toolWindow.contentManager.setSelectedContent(existing)
            return
        }
        val component = renderEntry(entry)
        val title = entry.manifest.displayName ?: id
        val content = toolWindow.contentManager.factory.createContent(component, title, false)
        content.isCloseable = true
        toolWindow.contentManager.addContent(content)
        toolWindow.contentManager.setSelectedContent(content)
        tabs[id] = content
    }

    /**
     * Render the extension's UI. For ui-v1 bundles this means loading
     * `<installDir>/<main.ui>` in a JCEF browser. For wasm components
     * we currently fall back to a hint panel (full activation is wired
     * through the runtime panel).
     */
    private fun renderEntry(entry: InstalledStoreReader.Entry): JPanel {
        val main = entry.manifest.mainUi
        if (main != null) {
            val htmlPath = entry.installDir.resolve(main)
            if (JBCefApp.isSupported() && java.nio.file.Files.isRegularFile(htmlPath)) {
                val browser = JBCefBrowser.createBuilder().setOffScreenRendering(false).build()
                browser.loadURL(htmlPath.toUri().toString())
                val wrap = JPanel(BorderLayout())
                wrap.add(browser.component, BorderLayout.CENTER)
                return wrap
            }
        }
        // Fallback: show metadata only.
        val p = JPanel(BorderLayout())
        p.border = BorderFactory.createTitledBorder("${entry.manifest.id}@${entry.manifest.version}")
        val text = buildString {
            appendLine(entry.manifest.displayName ?: entry.manifest.id)
            entry.manifest.description?.let { appendLine(it) }
            appendLine()
            appendLine("Kind: ${entry.kind}")
            appendLine("Path: ${entry.installDir}")
            if (entry.manifest.mainComponent != null) {
                appendLine()
                appendLine("This is a wasm component — open the Runtime tab")
                appendLine("and click 'Start runtime' to activate it.")
            } else if (!JBCefApp.isSupported()) {
                appendLine()
                appendLine("JCEF is not available — enable it in")
                appendLine("Help → Find Action → 'Choose Boot Java Runtime…'")
                appendLine("and pick a JBR with JCEF.")
            }
        }
        val area = javax.swing.JTextArea(text).apply {
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
            border = JBUI.Borders.empty(8)
        }
        p.add(JBScrollPane(area), BorderLayout.CENTER)
        return p
    }

    private class EntryCellRenderer : ListCellRenderer<InstalledStoreReader.Entry> {
        override fun getListCellRendererComponent(
            list: JList<out InstalledStoreReader.Entry>,
            value: InstalledStoreReader.Entry,
            index: Int,
            isSelected: Boolean,
            cellHasFocus: Boolean,
        ): Component {
            val panel = JPanel(BorderLayout())
            panel.border = JBUI.Borders.empty(4, 6)
            val title = value.manifest.displayName ?: value.manifest.id
            val sub = "${value.manifest.id}  ·  v${value.manifest.version}  ·  ${value.kind}"
            val label = JBLabel("<html><b>$title</b><br/><span style='color:#888'>$sub</span></html>")
            panel.add(label, BorderLayout.CENTER)
            if (isSelected) {
                panel.background = list.selectionBackground
                label.foreground = list.selectionForeground
            } else {
                panel.background = list.background
                label.foreground = list.foreground
            }
            panel.isOpaque = true
            return panel
        }
    }
}

/** Bridge a [NotifyInboxWatcher] event to the installed panel. */
internal fun NotifyInboxWatcher.NotifyEvent.shouldOpenInPanel(): Boolean =
    (kind == "installed" || kind == "updated") && !id.isNullOrBlank()
