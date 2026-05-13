package dev.oxp.jetbrains.ui

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.RegisterToolWindowTask
import com.intellij.openapi.wm.ToolWindowAnchor
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.ToolWindowType
import dev.oxp.jetbrains.runtime.InstalledStoreReader
import javax.swing.SwingUtilities

/**
 * Project-level service that manages one native JetBrains tool window per
 * OXP extension. When the user toggles an extension ON in the Switchboard,
 * this service registers a dedicated tool window (LEFT anchor) and loads the
 * extension's JCEF browser inside it. Toggle OFF → unregisters and removes it.
 *
 * State (which extensions are visible) is persisted in PropertiesComponent so
 * it survives IDE restarts. Call [restoreAll] during project startup to bring
 * previously-visible extensions back.
 */
@Service(Service.Level.PROJECT)
class ExtensionToolWindowManager(private val project: Project) {

    companion object {
        fun getInstance(project: Project): ExtensionToolWindowManager =
            project.getService(ExtensionToolWindowManager::class.java)

        private const val VISIBLE_KEY = "oxp.visibleExtensions"
        private const val TOOL_WINDOW_PREFIX = "oxp.ext."
    }

    private val props = PropertiesComponent.getInstance(project)

    fun visibleIds(): Set<String> {
        val raw = props.getValue(VISIBLE_KEY, "")
        return if (raw.isBlank()) emptySet() else raw.split(",").filter { it.isNotBlank() }.toSet()
    }

    fun isVisible(extId: String): Boolean = visibleIds().contains(extId)

    /** Toggle visibility. Registers or unregisters the tool window accordingly. */
    fun setVisible(extId: String, visible: Boolean) {
        val current = visibleIds().toMutableSet()
        if (visible) current.add(extId) else current.remove(extId)
        props.setValue(VISIBLE_KEY, current.joinToString(","))

        SwingUtilities.invokeLater {
            if (visible) showToolWindow(extId) else hideToolWindow(extId)
        }
    }

    /** Re-open all tool windows that were visible before the IDE was closed. */
    fun restoreAll() {
        SwingUtilities.invokeLater {
            for (extId in visibleIds()) {
                showToolWindow(extId)
            }
        }
    }

    /**
     * Open the extension in a floating (undocked) window.
     * If the tool window doesn't exist yet, registers it first (and marks it visible).
     */
    fun openInFloating(extId: String) {
        if (!isVisible(extId)) {
            setVisible(extId, true)
        }
        SwingUtilities.invokeLater {
            val tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_PREFIX + extId)
                ?: return@invokeLater
            tw.setType(ToolWindowType.FLOATING, null)
            tw.show()
        }
    }

    /** Called when a new extension is installed — auto-show it and mark as visible. */
    fun onExtensionInstalled(extId: String) {
        setVisible(extId, true)
    }

    private fun showToolWindow(extId: String) {
        val manager = ToolWindowManager.getInstance(project)
        val twId = TOOL_WINDOW_PREFIX + extId

        val existing = manager.getToolWindow(twId)
        if (existing != null) {
            existing.show()
            return
        }

        val entry = InstalledStoreReader.get(extId) ?: return
        val displayName = entry.manifest.displayName ?: extId.substringAfterLast("/")
        val panel = ExtensionBrowserPanel.create(entry)

        val task = RegisterToolWindowTask(
            id = twId,
            anchor = ToolWindowAnchor.LEFT,
            stripeTitle = java.util.function.Supplier { displayName },
            canCloseContent = false,
            shouldBeAvailable = true,
        )
        val tw = manager.registerToolWindow(task)
        val content = tw.contentManager.factory.createContent(panel, null, false)
        tw.contentManager.addContent(content)
        tw.show()
    }

    @Suppress("DEPRECATION")
    private fun hideToolWindow(extId: String) {
        val manager = ToolWindowManager.getInstance(project)
        val twId = TOOL_WINDOW_PREFIX + extId
        val tw = manager.getToolWindow(twId) ?: return
        tw.hide()
        try {
            manager.unregisterToolWindow(twId)
        } catch (_: Exception) {
            // Tool window may already be gone if the project is closing.
        }
    }
}
