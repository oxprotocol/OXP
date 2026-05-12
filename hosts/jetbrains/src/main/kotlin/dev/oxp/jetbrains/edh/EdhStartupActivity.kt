package dev.oxp.jetbrains.edh

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.wm.ToolWindowManager
import dev.oxp.jetbrains.runtime.InstalledStoreReader
import dev.oxp.jetbrains.runtime.NotifyInboxWatcher

/**
 * Runs on every project open. Two responsibilities:
 *
 * 1. **EDH auto-attach** — If a fresh EDH marker is waiting for
 *    *this* project, consume it and attach the project's [OxpDevSession]
 *    to the running `oxp dev` over the WebSocket URL the CLI wrote.
 *
 * 2. **Notify watcher** — Tail `~/.oxp/notify/inbox.jsonl` so that
 *    `oxp install @x/y` from *any* terminal auto-opens the OXP tool
 *    window and renders the extension. This runs unconditionally,
 *    even if the user has never clicked the OXP icon.
 */
class EdhStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        // Always start the late-marker watcher: it will pick up a
        // marker that `oxp dev` writes *after* the project is already
        // open, which is the common case when the user runs the CLI
        // from a terminal inside an already-open IntelliJ window.
        project.getService(EdhMarkerWatcher::class.java).start()

        // ── Notify watcher: auto-open extensions on CLI install ──
        // This runs at startup so the tool window doesn't need to be
        // open for installs to be detected. When an install event
        // arrives, we force-open the OXP tool window and load the
        // extension in the Installed panel.
        startNotifyWatcher(project)

        // ── EDH marker check ──
        val basePath = project.basePath ?: return
        val payload = EdhMarker.consumeIfMatches(basePath) ?: return

        if (payload.wsUrl.isBlank()) {
            thisLogger().warn(
                "OXP EDH: marker matched but wsUrl is empty — run `oxp dev` " +
                    "from a terminal to drive the EDH window."
            )
            notify(
                project,
                "OXP: stale EDH marker (no wsUrl). Run `oxp dev` from a terminal.",
                NotificationType.WARNING,
            )
            return
        }

        thisLogger().info(
            "OXP EDH: consumed marker for $basePath, attaching to ${payload.wsUrl}"
        )

        val session = project.getService(OxpDevSession::class.java)
        session.attach(payload)

        ApplicationManager.getApplication().invokeLater {
            ToolWindowManager.getInstance(project)
                .getToolWindow("OXP Dev")
                ?.activate(null, true)
        }

        notify(
            project,
            "OXP: Extension Development Host attached to ${payload.wsUrl}",
            NotificationType.INFORMATION,
        )
    }

    /**
     * Start the `~/.oxp/notify/inbox.jsonl` watcher. When a new
     * `installed` or `updated` event arrives, force-open the OXP
     * tool window and auto-open the extension's UI tab.
     */
    private fun startNotifyWatcher(project: Project) {
        val watcher = NotifyInboxWatcher()
        watcher.addListener { ev ->
            if (ev.kind == "installed" || ev.kind == "updated") {
                val id = ev.id ?: return@addListener
                thisLogger().info("OXP: CLI installed $id — opening in IDE")

                // Show a balloon so the user knows something happened
                notify(
                    project,
                    "OXP: Installed $id — opening in OXP panel",
                    NotificationType.INFORMATION,
                )

                ApplicationManager.getApplication().invokeLater {
                    // Force-open the OXP tool window (even if never opened)
                    val tw = ToolWindowManager.getInstance(project)
                        .getToolWindow("OXP")
                    tw?.activate({
                        // Once visible, find the InstalledExtensionsPanel and
                        // tell it to open this extension.
                        val content = tw.contentManager.contents.firstOrNull()
                        val panel = content?.component as? dev.oxp.jetbrains.ui.InstalledExtensionsPanel
                        panel?.openById(id)
                    }, true)
                }
            } else if (ev.kind == "uninstalled") {
                // Just refresh the list, no popup needed
                ApplicationManager.getApplication().invokeLater {
                    val tw = ToolWindowManager.getInstance(project)
                        .getToolWindow("OXP") ?: return@invokeLater
                    val content = tw.contentManager.contents.firstOrNull()
                    val panel = content?.component as? dev.oxp.jetbrains.ui.InstalledExtensionsPanel
                    panel?.refresh()
                }
            }
        }
        watcher.start()
    }

    private fun notify(
        project: Project,
        msg: String,
        type: NotificationType = NotificationType.INFORMATION,
    ) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("OXP")
                .createNotification(msg, type)
                .notify(project)
        }
    }
}

