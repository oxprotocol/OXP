package dev.oxp.jetbrains.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import dev.oxp.jetbrains.runtime.CapabilityInfo
import dev.oxp.jetbrains.runtime.PermissionCatalog
import java.awt.Component
import java.awt.Dimension
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Install-time multi-select dialog. One checkbox per known capability,
 * with a description and a warning marker for sensitive scopes.
 *
 * Returns the selected scope ids on OK, `null` on cancel.
 */
object PermissionPrompt {
    fun show(
        project: Project?,
        extensionId: String,
        preselected: Set<String> = emptySet(),
    ): List<String>? {
        val dlg = PermissionDialog(project, extensionId, preselected)
        return if (dlg.showAndGet()) dlg.selected() else null
    }
}

private class PermissionDialog(
    project: Project?,
    private val extensionId: String,
    preselected: Set<String>,
) : DialogWrapper(project, true) {

    private val checkboxes: List<Pair<JBCheckBox, CapabilityInfo>>

    init {
        title = "Grant permissions"
        setOKButtonText("Grant & install")
        setCancelButtonText("Cancel install")
        checkboxes = PermissionCatalog.ALL.map { cap ->
            val cb = JBCheckBox(cap.id).apply {
                isSelected = cap.id in preselected
                toolTipText = cap.description
            }
            cb to cap
        }
        init()
    }

    fun selected(): List<String> = checkboxes.filter { it.first.isSelected }.map { it.second.id }

    override fun createCenterPanel(): JComponent {
        val list = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
        list.add(JBLabel("<html><body style='width:380px;'>Choose which capabilities <b>$extensionId</b> may use. " +
            "You can change these later from the OXP tool window.</body></html>").apply {
            border = JBUI.Borders.empty(0, 0, 8, 0)
        })

        for ((cb, info) in checkboxes) {
            val row = JPanel().apply {
                layout = BoxLayout(this, BoxLayout.X_AXIS)
                alignmentX = Component.LEFT_ALIGNMENT
                border = JBUI.Borders.empty(2, 0)
            }
            row.add(cb)
            val desc = JBLabel(info.description).apply {
                foreground = JBColor.GRAY
                border = JBUI.Borders.emptyLeft(8)
            }
            row.add(desc)
            if (info.sensitive) {
                row.add(JBLabel(" · sensitive").apply {
                    foreground = JBColor.ORANGE
                    border = JBUI.Borders.emptyLeft(6)
                })
            }
            if (info.verifiedOnly) {
                row.add(JBLabel(" · verified-only").apply {
                    foreground = JBColor.RED
                    border = JBUI.Borders.emptyLeft(6)
                })
            }
            list.add(row)
        }

        val scroll = JBScrollPane(list).apply {
            preferredSize = Dimension(540, 420)
            border = JBUI.Borders.empty()
        }
        return scroll
    }
}
