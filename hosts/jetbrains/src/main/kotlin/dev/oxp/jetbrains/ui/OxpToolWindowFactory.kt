package dev.oxp.jetbrains.ui

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import dev.oxp.jetbrains.runtime.NotifyInboxWatcher
import dev.oxp.jetbrains.runtime.OxpRuntimeService
import javax.swing.SwingUtilities

/**
 * Factory for the main "OXP" tool window.
 *
 * The window now shows two tabs:
 *  - "Switchboard" — toggle switches that pin extensions as native side panels
 *  - "Installed"   — the legacy list view for browsing and one-click open in a tab
 *
 * When an extension is toggled ON in the Switchboard, [ExtensionToolWindowManager]
 * registers a dedicated JetBrains tool window (LEFT anchor) for it, so it lives
 * as an independent panel alongside the Project / Structure / Git views. Toggle
 * OFF → that tool window is removed.
 */
class OxpToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val cm = toolWindow.contentManager

        // ── Tab 1: Switchboard ──────────────────────────────────────────────
        val switchboard = SwitchboardPanel(project)
        val switchboardContent = cm.factory.createContent(switchboard, "Switchboard", false)
        switchboardContent.isCloseable = false
        cm.addContent(switchboardContent)

        // ── Tab 2: Installed (legacy browse + tab-open) ─────────────────────
        val installedPanel = InstalledExtensionsPanel(project, toolWindow)
        val installedContent = cm.factory.createContent(installedPanel, "Installed", false)
        installedContent.isCloseable = false
        cm.addContent(installedContent)

        // ── Restore previously-visible extension tool windows ───────────────
        // Deferred so ToolWindowManager is fully initialised before we try to
        // register dynamic tool windows.
        SwingUtilities.invokeLater {
            ExtensionToolWindowManager.getInstance(project).restoreAll()
        }

        // ── Notify inbox watcher ────────────────────────────────────────────
        // `oxp install @pub/slug` from any terminal auto-opens the new
        // extension (both in the Installed list and as its own side panel).
        val notifyWatcher = NotifyInboxWatcher()
        val unsubscribeNotify = notifyWatcher.addListener { ev ->
            when (ev.kind) {
                "installed", "updated" -> ev.id?.let { id ->
                    installedPanel.openById(id)
                    ExtensionToolWindowManager.getInstance(project).onExtensionInstalled(id)
                    SwingUtilities.invokeLater { switchboard.refresh() }
                }
                "uninstalled" -> {
                    installedPanel.refresh()
                    SwingUtilities.invokeLater { switchboard.refresh() }
                }
            }
        }
        notifyWatcher.start()
        com.intellij.openapi.util.Disposer.register(toolWindow.disposable) {
            unsubscribeNotify()
            notifyWatcher.dispose()
        }

        // ── Wasm UI-tree render listener ────────────────────────────────────
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
                    val c = cm.factory.createContent(rendered, title, false)
                    cm.addContent(c)
                    tabs[ev.instanceId] = c
                }
            }
        }
        val unsubscribeUiNotify = service.addUiNotifyListener { ev ->
            NotificationGroupManager.getInstance().getNotificationGroup("OXP")
                .createNotification("[${ev.extensionId}] ${ev.message}", NotificationType.INFORMATION)
                .notify(project)
        }
        com.intellij.openapi.util.Disposer.register(toolWindow.disposable) {
            unsubscribeRender()
            unsubscribeUiNotify()
        }
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}
