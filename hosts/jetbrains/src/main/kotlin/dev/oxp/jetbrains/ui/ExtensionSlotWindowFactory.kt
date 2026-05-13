package dev.oxp.jetbrains.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory

/**
 * Factory for the eight statically-declared LEFT-anchor extension slots
 * (oxp.ext.slot.0 … oxp.ext.slot.7) declared in plugin.xml.
 *
 * Slots start hidden (shouldBeAvailable returns false). At runtime,
 * ExtensionToolWindowManager assigns an extension to a slot by calling
 * setStripeTitle + setAvailable(true) — no registerToolWindow / unregisterToolWindow
 * calls anywhere.
 *
 * createToolWindowContent delegates to the manager so the right extension's
 * JCEF panel is loaded for whichever extension owns this slot at the moment
 * the platform first opens it.
 */
class ExtensionSlotWindowFactory : ToolWindowFactory {

    override fun shouldBeAvailable(project: Project): Boolean = false

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val slotIdx = toolWindow.id.substringAfterLast(".").toIntOrNull() ?: return
        ExtensionToolWindowManager.getInstance(project).populateSlotContent(slotIdx, toolWindow)
    }
}
