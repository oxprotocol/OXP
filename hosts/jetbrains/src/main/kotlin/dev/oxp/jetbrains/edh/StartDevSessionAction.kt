package dev.oxp.jetbrains.edh

import com.intellij.ide.impl.OpenProjectTask
import com.intellij.ide.impl.ProjectUtil
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import java.nio.file.Files
import java.nio.file.Paths

/**
 * "OXP: Start Dev Session" — JetBrains analogue of the VS Code command
 * `oxp.devStart`. Mirrors VS Code's F5 EDH workflow:
 *
 *   1. Resolve the project folder containing `oxp.json` (current project if
 *      it matches, otherwise prompt the user to pick one).
 *   2. Write a marker file at `$OXP_HOME/edh/autostart.json`.
 *   3. Open that folder in a **new IDE window** with `forceOpenInNewFrame`.
 *   4. The new window's [EdhStartupActivity] reads the marker and runs
 *      `oxp dev` against the project, exactly like Cursor/VS Code do.
 *
 * The developer's original window is untouched — they keep editing.
 */
class StartDevSessionAction : AnAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        val folder = pickOxpFolder(project) ?: return

        EdhMarker.write(folder.path)

        // Open the folder in a brand-new IDE frame.
        val openTask = OpenProjectTask {
            forceOpenInNewFrame = true
            projectToClose = null
        }
        val opened = ProjectUtil.openOrImport(Paths.get(folder.path), openTask)
        if (opened == null) {
            notify(project, "OXP: failed to open EDH window", NotificationType.ERROR)
            return
        }
        notify(
            project,
            "OXP: launching Extension Development Host…",
            NotificationType.INFORMATION,
        )
    }

    /**
     * Return the project's base dir if it already contains `oxp.json`,
     * otherwise prompt the user to pick a folder.
     */
    private fun pickOxpFolder(project: Project?): VirtualFile? {
        val base = project?.basePath
        if (base != null && Files.exists(Paths.get(base, "oxp.json"))) {
            return com.intellij.openapi.vfs.LocalFileSystem.getInstance()
                .findFileByPath(base)
        }
        val descriptor = FileChooserDescriptorFactory
            .createSingleFolderDescriptor()
            .withTitle("Pick an OXP Extension Folder")
            .withDescription("Folder must contain an oxp.json")
        val picked = FileChooser.chooseFile(descriptor, project, null) ?: return null
        if (!Files.exists(Paths.get(picked.path, "oxp.json"))) {
            notify(project, "OXP: selected folder has no oxp.json", NotificationType.ERROR)
            return null
        }
        return picked
    }

    private fun notify(project: Project?, msg: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("OXP")
                .createNotification(msg, type)
                .notify(project)
        }
    }
}
