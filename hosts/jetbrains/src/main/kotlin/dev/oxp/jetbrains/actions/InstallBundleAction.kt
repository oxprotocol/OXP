package dev.oxp.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import dev.oxp.jetbrains.protocol.LoadParams
import dev.oxp.jetbrains.runtime.OxpRuntimeService

/**
 * Tools → OXP → Install OXP Bundle…
 *
 * Prompts the user for a `.wasm` file (or a bundle directory containing
 * `extension.wasm`) and asks the runtime service to load + activate it.
 */
class InstallBundleAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val descriptor = FileChooserDescriptor(true, true, false, false, false, false)
            .withTitle("Select OXP Bundle")
            .withDescription("Pick an extension.wasm file or a bundle directory.")
            .withFileFilter { vf -> vf.isDirectory || vf.extension == "wasm" }

        val chosen = FileChooser.chooseFile(descriptor, e.project, null) ?: return
        val service = OxpRuntimeService.getInstance()
        val name = chosen.nameWithoutExtension.ifBlank { "bundle" }
        service.installAndActivate(
            e.project,
            LoadParams(
                extensionId = "@local/$name",
                version = "0.0.0",
                bundlePath = chosen.path,
                permissions = emptyList(),
                surfacesRequired = emptyList(),
                surfacesOptional = emptyList(),
            ),
        )
    }
}
