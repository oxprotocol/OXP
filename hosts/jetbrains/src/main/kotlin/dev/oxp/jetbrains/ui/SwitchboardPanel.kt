package dev.oxp.jetbrains.ui

import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import dev.oxp.jetbrains.runtime.InstalledStoreReader
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingUtilities

class SwitchboardPanel(private val project: Project) : JPanel(BorderLayout()) {

    private val manager get() = ExtensionToolWindowManager.getInstance(project)
    private val rowsPanel = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        background = UIUtil.getPanelBackground()
        isOpaque = true
    }

    init {
        background = UIUtil.getPanelBackground()
        isOpaque = true
        add(buildHeader(), BorderLayout.NORTH)
        add(JBScrollPane(rowsPanel).apply { border = null }, BorderLayout.CENTER)
        refresh()
    }

    private fun buildHeader(): JPanel {
        val p = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.compound(
                JBUI.Borders.customLineBottom(JBColor.border()),
                JBUI.Borders.empty(10, 12, 10, 10),
            )
            background = UIUtil.getPanelBackground()
            isOpaque = true
        }
        p.add(JLabel("OXP Extensions").apply {
            font = UIUtil.getLabelFont().deriveFont(Font.BOLD, 13f)
        }, BorderLayout.WEST)
        p.add(JButton(AllIcons.Actions.Refresh).apply {
            toolTipText = "Refresh"
            isContentAreaFilled = false
            isBorderPainted = false
            preferredSize = Dimension(22, 22)
            addActionListener { refresh() }
        }, BorderLayout.EAST)
        return p
    }

    fun refresh() {
        val entries = try { InstalledStoreReader.list() } catch (_: Exception) { emptyList() }
        SwingUtilities.invokeLater {
            rowsPanel.removeAll()
            if (entries.isEmpty()) {
                rowsPanel.add(buildEmptyState())
            } else {
                for ((idx, entry) in entries.withIndex()) {
                    try {
                        rowsPanel.add(buildRow(entry, idx == entries.lastIndex))
                    } catch (_: Exception) { /* skip broken entry */ }
                }
            }
            rowsPanel.add(Box.createVerticalGlue())
            rowsPanel.revalidate()
            rowsPanel.repaint()
        }
    }

    // ── Row ───────────────────────────────────────────────────────────

    private fun buildRow(entry: InstalledStoreReader.Entry, isLast: Boolean): JPanel {
        val id = entry.manifest.id
        val displayName = entry.manifest.displayName ?: id.substringAfterLast("/")
        val version = entry.manifest.version

        val normalBg = UIUtil.getPanelBackground()
        val hoverBg  = JBColor(Color(0xEEEBFF), Color(0x2A2040))

        val row = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.compound(
                if (!isLast) JBUI.Borders.customLineBottom(JBColor.border())
                else JBUI.Borders.empty(),
                JBUI.Borders.empty(8, 12, 8, 10),
            )
            background = normalBg
            isOpaque = true
            maximumSize = Dimension(Int.MAX_VALUE, 58)
        }

        // Avatar
        val avatar = AvatarCircle(displayName, id)

        // Text stack
        val textCol = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyLeft(10)
        }
        textCol.add(JLabel(displayName).apply {
            font = UIUtil.getLabelFont().deriveFont(Font.BOLD, 13f)
        }, BorderLayout.CENTER)
        textCol.add(JBLabel(id).apply {
            font = UIUtil.getLabelFont().deriveFont(11f)
            foreground = UIUtil.getContextHelpForeground()
        }, BorderLayout.SOUTH)

        // Controls: pop-out + toggle checkbox styled as switch
        val controls = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            isOpaque = false
        }

        val floatBtn = JButton("↗").apply {
            toolTipText = "Open in floating window"
            isContentAreaFilled = false
            isBorderPainted = false
            font = font.deriveFont(13f)
            foreground = UIUtil.getContextHelpForeground()
            preferredSize = Dimension(26, 26)
            addActionListener {
                manager.setVisible(id, true)
                manager.openInFloating(id)
            }
        }

        val toggle = JBCheckBox().apply {
            isSelected = manager.isVisible(id)
            isOpaque = false
            toolTipText = if (isSelected) "Hide panel" else "Show in sidebar"
            addActionListener {
                manager.setVisible(id, isSelected)
                toolTipText = if (isSelected) "Hide panel" else "Show in sidebar"
            }
        }

        controls.add(floatBtn)
        controls.add(Box.createHorizontalStrut(4))
        controls.add(toggle)

        row.add(avatar, BorderLayout.WEST)
        row.add(textCol, BorderLayout.CENTER)
        row.add(controls, BorderLayout.EAST)

        // Hover tint
        val hoverListener = object : MouseAdapter() {
            override fun mouseEntered(e: MouseEvent) { row.background = hoverBg; row.repaint() }
            override fun mouseExited(e: MouseEvent)  { row.background = normalBg; row.repaint() }
        }
        row.addMouseListener(hoverListener)

        return row
    }

    // ── Empty state ───────────────────────────────────────────────────

    private fun buildEmptyState(): JPanel = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty(32, 20)
        isOpaque = false
        add(JBLabel(
            "<html><center>" +
            "<b style='font-size:13px'>No extensions installed</b><br/><br/>" +
            "<span style='color:#888;font-size:11px'>Run <code>oxp install @pub/slug</code>" +
            "<br/>in a terminal to get started.</span>" +
            "</center></html>"
        ).apply { horizontalAlignment = JBLabel.CENTER }, BorderLayout.CENTER)
    }
}

// ── Colored avatar circle ──────────────────────────────────────────────────

private class AvatarCircle(name: String, seed: String) : JComponent() {
    private val initial: Char = name.firstOrNull()?.uppercaseChar() ?: '?'
    private val bg: Color = PALETTE[(seed.hashCode() and 0x7FFFFFFF) % PALETTE.size]

    init {
        preferredSize = Dimension(32, 32)
        minimumSize  = Dimension(32, 32)
        maximumSize  = Dimension(32, 32)
        isOpaque = false
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        g2.color = bg
        g2.fillOval(0, 0, width, height)
        g2.color = Color.WHITE
        g2.font = g2.font.deriveFont(Font.BOLD, 14f)
        val fm = g2.fontMetrics
        val tx = (width  - fm.charWidth(initial)) / 2
        val ty = (height + fm.ascent - fm.descent) / 2
        g2.drawString(initial.toString(), tx, ty)
        g2.dispose()
    }

    companion object {
        private val PALETTE = arrayOf(
            Color(0x7C3AED), Color(0x2563EB), Color(0x059669),
            Color(0xD97706), Color(0xDC2626), Color(0x0891B2),
            Color(0xDB2777), Color(0x16A34A),
        )
    }
}
