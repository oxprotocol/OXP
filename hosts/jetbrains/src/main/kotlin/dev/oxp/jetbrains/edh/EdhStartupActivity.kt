package dev.oxp.jetbrains.edh

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Runs on every project open. If a fresh EDH marker is waiting for
 * *this* project, consume it and attach the project's [OxpDevSession]
 * to the running `oxp dev` over the WebSocket URL the CLI wrote.
 *
 * This is the mirror image of VS Code's `attachToRunningSession`. The
 * CLI is the single source of truth — it built the bundle, it owns the
 * port, and it tells us where to connect. We never spawn `oxp dev`
 * from inside the IDE: that would create a second CLI for the same
 * session and race on the port.
 */
class EdhStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        // Always start the late-marker watcher: it will pick up a
        // marker that `oxp dev` writes *after* the project is already
        // open, which is the common case when the user runs the CLI
        // from a terminal inside an already-open IntelliJ window.
        project.getService(EdhMarkerWatcher::class.java).start()

        val basePath = project.basePath ?: return
        val payload = EdhMarker.consumeIfMatches(basePath) ?: return

        if (payload.wsUrl.isBlank()) {
            // Legacy marker (StartDevSessionAction wrote it). We have no
            // wsUrl to attach to. Surface a single-line warning so the
            // user understands why nothing happened, then bail.
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

        // Attach the project's dev-session service to the WS endpoint.
        // The OxpDevToolWindowFactory listens on the same service and
        // renders the extension UI inside the OXP Dev tool window.
        val session = project.getService(OxpDevSession::class.java)
        session.attach(payload)

        // Pop the OXP Dev tool window so the user immediately sees the
        // EDH surface. Activation must run on the EDT.
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
