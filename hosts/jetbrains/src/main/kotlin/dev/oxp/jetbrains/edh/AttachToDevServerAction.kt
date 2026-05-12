package dev.oxp.jetbrains.edh

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Manual fallback for "the marker is on disk but nothing happened".
 *
 * Normally [EdhStartupActivity] consumes the marker on project open
 * and [EdhMarkerWatcher] consumes it later if `oxp dev` is launched
 * after the window already exists. This action is the user-visible
 * escape hatch for the rare case where both paths missed it (e.g. the
 * project is opened before `oxp dev` has finished binding its port
 * and the watcher hasn't ticked yet, or the user wants to re-attach
 * after a disconnect without re-running `oxp dev`).
 *
 * Triggered via Tools ▸ OXP ▸ Attach to OXP Dev Server.
 */
class AttachToDevServerAction : AnAction() {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val basePath = project.basePath
        if (basePath == null) {
            notify(project, "OXP: no project base path", NotificationType.WARNING)
            return
        }

        val payload = EdhMarker.consumeIfMatches(basePath)
        if (payload == null) {
            notify(
                project,
                "OXP: no fresh EDH marker for this project. " +
                    "Run `oxp dev` in the project folder first.",
                NotificationType.WARNING,
            )
            return
        }
        if (payload.wsUrl.isBlank()) {
            notify(
                project,
                "OXP: EDH marker has no wsUrl. Run `oxp dev` from a terminal.",
                NotificationType.WARNING,
            )
            return
        }

        project.getService(OxpDevSession::class.java).attach(payload)

        ApplicationManager.getApplication().invokeLater {
            ToolWindowManager.getInstance(project)
                .getToolWindow("OXP Dev")
                ?.activate(null, true)
        }

        notify(
            project,
            "OXP: attaching to ${payload.wsUrl}",
            NotificationType.INFORMATION,
        )
    }

    private fun notify(project: Project, msg: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("OXP")
                .createNotification(msg, type)
                .notify(project)
        }
    }
}
