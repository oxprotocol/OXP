package dev.oxp.jetbrains.ui

import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import dev.oxp.jetbrains.runtime.OxpRuntimeService
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.Font
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JPanel
import javax.swing.JPasswordField
import javax.swing.JSeparator
import javax.swing.SwingConstants

/**
 * Decodes an `oxp-ui-v1` JSON tree and produces a Swing JPanel. Mirrors
 * the VS Code webview renderer in [`hosts/vscode/src/extension-ui-panel.ts`]
 * one-for-one — same node kinds, same event payloads going back over RPC.
 *
 * User input is forwarded straight to the wasm side as `extension/event`
 * notifications carrying a [UiEvent] JSON object.
 */
object UiTreeRenderer {
    private val log = Logger.getInstance(UiTreeRenderer::class.java)
    private val json = Json { ignoreUnknownKeys = true; classDiscriminator = "kind" }

    fun build(treeJson: String, instanceId: String, service: OxpRuntimeService): JPanel {
        val node = try { json.decodeFromString(UiNode.serializer(), treeJson) }
        catch (e: Exception) {
            log.warn("invalid UI tree from $instanceId: ${e.message}")
            return errorPanel("Invalid UI tree: ${e.message}")
        }
        val root = JPanel(BorderLayout())
        root.border = JBUI.Borders.empty(8)
        root.add(render(node, instanceId, service), BorderLayout.NORTH)
        return root
    }

    private fun render(node: UiNode, inst: String, svc: OxpRuntimeService): Component = when (node) {
        is UiNode.Box      -> renderBox(node, inst, svc)
        is UiNode.Text     -> renderText(node)
        is UiNode.Button   -> renderButton(node, inst, svc)
        is UiNode.Input    -> renderInput(node, inst, svc)
        is UiNode.Select   -> renderSelect(node, inst, svc)
        is UiNode.Checkbox -> renderCheckbox(node, inst, svc)
        is UiNode.Divider  -> JSeparator(SwingConstants.HORIZONTAL).apply { maximumSize = Dimension(Int.MAX_VALUE, 1) }
        is UiNode.Spacer   -> Box.createRigidArea(Dimension(node.size, node.size))
    }

    private fun renderBox(b: UiNode.Box, inst: String, svc: OxpRuntimeService): JPanel {
        val p = JPanel()
        p.layout = BoxLayout(p, if (b.layout == "row") BoxLayout.X_AXIS else BoxLayout.Y_AXIS)
        if (b.padding > 0) p.border = JBUI.Borders.empty(b.padding)
        for ((i, child) in b.children.withIndex()) {
            if (i > 0 && b.gap > 0) {
                p.add(if (b.layout == "row") Box.createHorizontalStrut(b.gap) else Box.createVerticalStrut(b.gap))
            }
            p.add(render(child, inst, svc))
        }
        return p
    }

    private fun renderText(t: UiNode.Text): JBLabel {
        val lbl = JBLabel(t.content)
        val baseFont = lbl.font
        val sizePx = when (t.size) {
            "xs" -> 11; "sm" -> 12; "lg" -> 18; else -> baseFont.size
        }
        var style = baseFont.style
        if (t.weight == "bold") style = style or Font.BOLD
        lbl.font = baseFont.deriveFont(style, sizePx.toFloat())
        when (t.color) {
            "muted"  -> lbl.foreground = JBColor.GRAY
            "error"  -> lbl.foreground = JBColor.RED
            "accent" -> lbl.foreground = JBColor(0x2470b3, 0x6cb6ff)
            else -> if (t.color != null && t.color.startsWith("#")) {
                runCatching { lbl.foreground = JBColor(java.awt.Color.decode(t.color), java.awt.Color.decode(t.color)) }
            }
        }
        return lbl
    }

    private fun renderButton(b: UiNode.Button, inst: String, svc: OxpRuntimeService): JButton {
        val btn = JButton(b.label)
        btn.isEnabled = !b.disabled
        btn.addActionListener {
            svc.sendEvent(inst, buildJsonObject {
                put("type", "click")
                put("id", b.id)
            })
        }
        return btn
    }

    private fun renderInput(i: UiNode.Input, inst: String, svc: OxpRuntimeService): Component {
        val tf = if (i.secret) JPasswordField(i.value ?: "") else JBTextField(i.value ?: "")
        if (tf is JBTextField && i.placeholder != null) tf.emptyText.text = i.placeholder
        tf.addActionListener {
            val text = if (tf is JPasswordField) String(tf.password) else (tf as JBTextField).text
            svc.sendEvent(inst, buildJsonObject {
                put("type", "input")
                put("id", i.id)
                put("value", text)
            })
        }
        return tf
    }

    private fun renderSelect(s: UiNode.Select, inst: String, svc: OxpRuntimeService): JComboBox<String> {
        val labels = s.options.map { it.label }.toTypedArray()
        val cb = JComboBox(labels)
        val sel = s.options.indexOfFirst { it.value == s.value }
        if (sel >= 0) cb.selectedIndex = sel
        cb.addActionListener {
            val idx = cb.selectedIndex.coerceAtLeast(0)
            val value = s.options.getOrNull(idx)?.value ?: return@addActionListener
            svc.sendEvent(inst, buildJsonObject {
                put("type", "input")
                put("id", s.id)
                put("value", value)
            })
        }
        return cb
    }

    private fun renderCheckbox(c: UiNode.Checkbox, inst: String, svc: OxpRuntimeService): JBCheckBox {
        val cb = JBCheckBox(c.label, c.checked)
        cb.addActionListener {
            svc.sendEvent(inst, buildJsonObject {
                put("type", "input")
                put("id", c.id)
                put("value", if (cb.isSelected) "true" else "false")
            })
        }
        return cb
    }

    private fun errorPanel(msg: String): JPanel {
        val p = JPanel(BorderLayout())
        p.border = JBUI.Borders.empty(8)
        p.add(JBLabel(msg).apply { foreground = JBColor.RED })
        return p
    }
}

/* -------------------------------------------------------------------------- */
/* Wire format — must match packages/types/src/ui-tree.ts                     */
/* -------------------------------------------------------------------------- */

@Serializable
@JsonClassDiscriminator("kind")
sealed class UiNode {
    @Serializable @SerialName("box")
    data class Box(
        val layout: String = "column",
        val gap: Int = 6,
        val padding: Int = 0,
        val id: String? = null,
        val children: List<UiNode> = emptyList(),
    ) : UiNode()

    @Serializable @SerialName("text")
    data class Text(
        val content: String,
        val size: String? = null,
        val weight: String? = null,
        val color: String? = null,
        val id: String? = null,
    ) : UiNode()

    @Serializable @SerialName("button")
    data class Button(
        val id: String,
        val label: String,
        val variant: String? = null,
        val disabled: Boolean = false,
    ) : UiNode()

    @Serializable @SerialName("input")
    data class Input(
        val id: String,
        val value: String? = null,
        val placeholder: String? = null,
        val secret: Boolean = false,
    ) : UiNode()

    @Serializable @SerialName("select")
    data class Select(
        val id: String,
        val options: List<SelectOption> = emptyList(),
        val value: String? = null,
    ) : UiNode()

    @Serializable @SerialName("checkbox")
    data class Checkbox(
        val id: String,
        val label: String,
        val checked: Boolean = false,
    ) : UiNode()

    @Serializable @SerialName("divider")
    object Divider : UiNode()

    @Serializable @SerialName("spacer")
    data class Spacer(val size: Int = 8) : UiNode()
}

@Serializable
data class SelectOption(val label: String, val value: String)
