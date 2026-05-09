package dev.oxp.jetbrains.host

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Capability descriptor sent in the `initialize` request. Tells the runtime
 * which surfaces and APIs this host can satisfy so it can refuse extensions
 * that require things JetBrains can't offer (or accept them in degraded mode).
 *
 * Keep this conservative: report only what we actually wire up. False
 * advertising = extensions silently break.
 */
object HostCapabilities {
    fun build(): JsonObject = buildJsonObject {
        putJsonObject("ui") {
            put("webview", true)        // JCEF is bundled in all JB IDEs since 2022.x
            put("treeView", true)        // ToolWindow + Tree
            put("statusBar", true)       // StatusBarWidget
            put("notification", true)    // Notifications API
            put("quickPick", true)       // JBPopupFactory.createPopupChooserBuilder
            put("inputBox", true)        // Messages.showInputDialog
        }
        putJsonObject("language") {
            put("completions", true)     // CompletionContributor
            put("hover", true)           // DocumentationProvider
            put("codeLens", true)        // InlayHintsProvider
            put("diagnostics", true)     // Annotator / HighlightInfo
            put("definition", true)      // GotoDeclarationHandler
            put("references", true)      // ReferencesSearch
            put("rename", true)          // RenameProcessor
            put("formatting", true)      // FormattingModelBuilder
            put("languageServer", true)  // LSP4IJ-style or platform LSP
        }
        putJsonObject("editor") {
            put("buffers", true)         // Document / Editor APIs
            put("decorations", true)     // RangeHighlighter
            put("selection", true)
            put("virtualText", true)     // Inlay hints
        }
        putJsonObject("fs") {
            put("workspaceScoped", true) // VirtualFileManager scoped to project
        }
        putJsonObject("process") {
            put("spawn", false)          // runtime sandbox owns process spawning
        }
        putJsonObject("secrets") {
            // PasswordSafe is always available; bridge it later.
            put("store", "passwordSafe")
        }
        putJsonObject("debugger") {
            put("dap", false)            // DAP support is per-language plugin; off for now
        }
        putJsonObject("terminal") {
            put("create", true)          // TerminalView
        }
    }
}
