package dev.oxp.jetbrains.ui

import com.intellij.ide.util.PropertiesComponent
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.ToolWindowType
import dev.oxp.jetbrains.runtime.InstalledStoreReader
import javax.swing.SwingUtilities

/**
 * Project-level service that maps installed OXP extensions onto the eight
 * statically-declared LEFT-anchor slot tool windows (oxp.ext.slot.0…7).
 *
 * When the user toggles an extension ON, this service finds a free slot,
 * updates its stripe title to the extension's display name, populates its
 * content manager with the JCEF browser panel, and calls setAvailable(true).
 * Toggle OFF: setAvailable(false), clear the content manager, free the slot.
 *
 * This approach uses only stable ToolWindow APIs (setAvailable, stripeTitle,
 * contentManager). It never calls registerToolWindow or unregisterToolWindow,
 * so the plugin verifier has no objections.
 */
@Service(Service.Level.PROJECT)
class ExtensionToolWindowManager(private val project: Project) {

    companion object {
        fun getInstance(project: Project): ExtensionToolWindowManager =
            project.getService(ExtensionToolWindowManager::class.java)

        private const val VISIBLE_KEY = "oxp.visibleExtensions"
        private const val ALLOC_KEY   = "oxp.slotAllocation"
        private const val SLOT_COUNT  = 8
        private const val SLOT_PREFIX = "oxp.ext.slot."
    }

    private val props = PropertiesComponent.getInstance(project)

    // slot index → ext id
    private val slotAlloc = mutableMapOf<Int, String>()
    // ext id → slot index
    private val extSlot = mutableMapOf<String, Int>()

    init {
        loadAllocation()
    }

    // ── Persistence ────────────────────────────────────────────────────

    private fun loadAllocation() {
        val raw = props.getValue(ALLOC_KEY, "")
        if (raw.isBlank()) return
        for (pair in raw.split(",")) {
            val parts = pair.split(":", limit = 2)
            if (parts.size != 2) continue
            val slot = parts[0].toIntOrNull() ?: continue
            val extId = parts[1]
            slotAlloc[slot] = extId
            extSlot[extId] = slot
        }
    }

    private fun saveAllocation() {
        val encoded = slotAlloc.entries.joinToString(",") { (k, v) -> "$k:$v" }
        props.setValue(ALLOC_KEY, encoded)
    }

    // ── Public API ─────────────────────────────────────────────────────

    fun visibleIds(): Set<String> {
        val raw = props.getValue(VISIBLE_KEY, "")
        return if (raw.isBlank()) emptySet()
               else raw.split(",").filter { it.isNotBlank() }.toSet()
    }

    fun isVisible(extId: String): Boolean = visibleIds().contains(extId)

    fun setVisible(extId: String, visible: Boolean) {
        val current = visibleIds().toMutableSet()
        if (visible) current.add(extId) else current.remove(extId)
        props.setValue(VISIBLE_KEY, current.joinToString(","))

        SwingUtilities.invokeLater {
            if (visible) showToolWindow(extId) else hideToolWindow(extId)
        }
    }

    fun restoreAll() {
        SwingUtilities.invokeLater {
            for (extId in visibleIds()) showToolWindow(extId, activate = false)
        }
    }

    fun openInFloating(extId: String) {
        if (!isVisible(extId)) setVisible(extId, true)
        SwingUtilities.invokeLater {
            val slotIdx = extSlot[extId] ?: return@invokeLater
            val tw = ToolWindowManager.getInstance(project)
                .getToolWindow(SLOT_PREFIX + slotIdx) ?: return@invokeLater
            tw.setType(ToolWindowType.FLOATING, null)
            tw.show()
        }
    }

    fun onExtensionInstalled(extId: String) = setVisible(extId, true)

    /**
     * Called by ExtensionSlotWindowFactory.createToolWindowContent when the
     * platform initialises a slot's content for the first time.
     */
    fun populateSlotContent(slotIdx: Int, toolWindow: ToolWindow) {
        val extId = slotAlloc[slotIdx] ?: return
        val entry = InstalledStoreReader.get(extId) ?: return
        if (toolWindow.contentManager.contentCount > 0) return
        val panel   = ExtensionBrowserPanel.create(entry)
        val content = toolWindow.contentManager.factory.createContent(panel, null, false)
        toolWindow.contentManager.addContent(content)
    }

    // ── Internals ──────────────────────────────────────────────────────

    private fun allocateSlot(extId: String): Int? {
        extSlot[extId]?.let { return it }
        for (i in 0 until SLOT_COUNT) {
            if (!slotAlloc.containsKey(i)) {
                slotAlloc[i] = extId
                extSlot[extId] = i
                saveAllocation()
                return i
            }
        }
        return null
    }

    private fun freeSlot(extId: String) {
        val slotIdx = extSlot.remove(extId) ?: return
        slotAlloc.remove(slotIdx)
        saveAllocation()
    }

    private fun showToolWindow(extId: String, activate: Boolean = true) {
        val entry = InstalledStoreReader.get(extId) ?: return
        val manager = ToolWindowManager.getInstance(project)
        val displayName = entry.manifest.displayName ?: extId.substringAfterLast("/")

        val slotIdx = allocateSlot(extId) ?: run {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("OXP")
                .createNotification(
                    "No free extension slots",
                    "All $SLOT_COUNT OXP extension panel slots are in use. Hide another extension first.",
                    NotificationType.WARNING,
                )
                .notify(project)
            return
        }

        val tw = manager.getToolWindow(SLOT_PREFIX + slotIdx) ?: return
        tw.stripeTitle = displayName

        if (tw.contentManager.contentCount == 0) {
            val panel   = ExtensionBrowserPanel.create(entry)
            val content = tw.contentManager.factory.createContent(panel, null, false)
            tw.contentManager.addContent(content)
        }

        tw.setAvailable(true)
        if (activate) tw.show()
    }

    private fun hideToolWindow(extId: String) {
        val slotIdx = extSlot[extId] ?: return
        val manager = ToolWindowManager.getInstance(project)
        val tw = manager.getToolWindow(SLOT_PREFIX + slotIdx) ?: return

        tw.contentManager.removeAllContents(true)
        tw.setAvailable(false)
        freeSlot(extId)
    }
}
