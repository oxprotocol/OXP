package dev.oxp.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages
import dev.oxp.jetbrains.runtime.OxpRuntimeService

class RuntimeStatusAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val s = OxpRuntimeService.getInstance().status()
        val body = buildString {
            appendLine("Running: ${s.running}")
            appendLine("PID: ${s.pid ?: "—"}")
            appendLine("Runtime: ${s.runtimeVersion ?: "—"}")
            appendLine("Engine: ${s.wasmEngine ?: "—"}")
            appendLine("Instances (${s.instances.size}):")
            s.instances.forEach { appendLine("  • $it") }
        }
        Messages.showInfoMessage(e.project, body, "OXP Runtime Status")
    }
}
