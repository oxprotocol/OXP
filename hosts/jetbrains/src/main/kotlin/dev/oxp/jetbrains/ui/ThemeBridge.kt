package dev.oxp.jetbrains.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.ui.JBColor
import java.awt.Color
import javax.swing.UIManager

/**
 * Theme bridge — mirrors the current IntelliJ Swing + editor color
 * scheme onto the `--vscode-*` CSS custom properties that webview
 * extensions read.
 *
 * Why: VS Code automatically injects ~150 `--vscode-*` variables onto
 * the webview's <html>. JCEF does not — so an OXP extension that
 * styles itself with those tokens (the canonical pattern) renders
 * unstyled in JetBrains. This bridge closes the gap by translating
 * the closest UIManager / editor-scheme colors into the same names
 * and injecting them via a tiny inline `<style>` element on every
 * page load (and on every LAF change).
 *
 * Only the high-traffic subset is mapped. Extensions that ask for an
 * obscure token simply get `var(--vscode-foo, <their fallback>)`,
 * which is the same behaviour as a VS Code theme that doesn't define
 * the token.
 */
internal object ThemeBridge {

    /**
     * Build the JS that, when evaluated in the JCEF document, installs
     * (or updates) a `<style id="__oxp-theme__">` element containing
     * `:root { --vscode-…: …; }` for every mapped token. Re-runnable —
     * if the element already exists it just rewrites its textContent.
     */
    fun injectScript(): String {
        val css = buildCss()
        // Escape backticks + backslashes for embedding in a JS template
        // literal. Newlines are fine in template literals.
        val escaped = css
            .replace("\\", "\\\\")
            .replace("`", "\\`")
        return """
(function () {
  var STYLE_ID = '__oxp_theme__';
  var css = `$escaped`;
  function apply() {
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
    // Also stamp a className the IDE webview convention uses so
    // CSS selectors like `body.vscode-dark` work.
    var theme = ${if (JBColor.isBright()) "'vscode-light'" else "'vscode-dark'"};
    if (document.body) {
      document.body.classList.remove('vscode-dark', 'vscode-light', 'vscode-high-contrast');
      document.body.classList.add(theme);
    }
  }
  if (document.documentElement) apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
        """.trimIndent()
    }

    private fun buildCss(): String {
        val scheme: EditorColorsScheme = EditorColorsManager.getInstance().globalScheme
        val editorBg = scheme.defaultBackground
        val editorFg = scheme.defaultForeground

        val foreground = ui("Label.foreground") ?: editorFg
        val description = ui("Label.disabledForeground") ?: foreground.dim(0.65f)
        val focus = ui("Component.focusColor")
            ?: ui("Focus.borderColor")
            ?: JBColor(Color(0x00, 0x97, 0xFB), Color(0x3D, 0x8E, 0xC9))
        val panelBg = ui("Panel.background") ?: editorBg
        val border = ui("Component.borderColor")
            ?: ui("Borders.color")
            ?: panelBg.dim(0.85f)

        val inputBg = ui("TextField.background") ?: panelBg
        val inputFg = ui("TextField.foreground") ?: foreground
        val inputBorder = ui("Component.borderColor") ?: border
        val inputPlaceholder = ui("TextField.inactiveForeground") ?: description

        val buttonBg = ui("Button.background") ?: ui("Button.startBackground") ?: panelBg
        val buttonFg = ui("Button.foreground") ?: foreground
        val buttonHover = buttonBg.mix(focus, 0.15f)

        val listSelBg = ui("List.selectionBackground")
            ?: ui("Tree.selectionBackground")
            ?: focus
        val listSelFg = ui("List.selectionForeground")
            ?: ui("Tree.selectionForeground")
            ?: foreground
        val listHover = ui("List.hoverBackground") ?: listSelBg.alpha(0.15f)
        val listInactiveSel = ui("List.selectionInactiveBackground")
            ?: listSelBg.alpha(0.4f)

        val sideBg = ui("ToolWindow.background") ?: panelBg
        val sideHeaderBg = ui("ToolWindow.HeaderTab.underlinedTabBackground") ?: panelBg

        val statusBg = ui("StatusBar.background") ?: panelBg
        val activityBg = sideBg
        val activityFg = foreground
        val activityBadgeBg = focus
        val activityBadgeFg = textOn(focus)

        // Map ANSI terminal colors to ConsoleColors when available;
        // otherwise fall back to a sensible standard 16-color palette.
        // These look the same as IntelliJ's built-in terminal.
        val ansi = ansiPalette()

        // Diff colors from the editor color scheme are exposed as
        // TextAttributes; we ask for them by key and fall back to a
        // tinted version of the editor background if the scheme is
        // exotic.
        val diffAdded = scheme.getColor(com.intellij.openapi.editor.colors.ColorKey.find("DIFF_INSERTED"))
            ?: Color(0x10, 0x40, 0x20)
        val diffRemoved = scheme.getColor(com.intellij.openapi.editor.colors.ColorKey.find("DIFF_DELETED"))
            ?: Color(0x55, 0x10, 0x10)
        val diffModified = scheme.getColor(com.intellij.openapi.editor.colors.ColorKey.find("DIFF_MODIFIED"))
            ?: Color(0x10, 0x30, 0x55)

        val sb = StringBuilder(2048)
        sb.append(":root {\n")
        sb.append("  color-scheme: ").append(if (JBColor.isBright()) "light" else "dark").append(";\n")

        // Base
        v(sb, "foreground", foreground)
        v(sb, "disabledForeground", description)
        v(sb, "errorForeground", Color(0xFF, 0x6B, 0x6B))
        v(sb, "descriptionForeground", description)
        v(sb, "focusBorder", focus)
        v(sb, "contrastBorder", border)
        v(sb, "contrastActiveBorder", focus)
        v(sb, "icon-foreground", foreground)
        v(sb, "selection-background", listSelBg.alpha(0.5f))

        // Editor
        v(sb, "editor-background", editorBg)
        v(sb, "editor-foreground", editorFg)
        v(sb, "editor-lineHighlightBackground", editorBg.mix(foreground, 0.05f))
        v(sb, "editor-selectionBackground", listSelBg.alpha(0.6f))
        v(sb, "editor-selectionHighlightBackground", listSelBg.alpha(0.3f))
        v(sb, "editor-findMatchBackground", Color(0x9E, 0x6A, 0x03))
        v(sb, "editor-findMatchHighlightBackground", Color(0x9E, 0x6A, 0x03).alpha(0.4f))
        v(sb, "editor-rangeHighlightBackground", editorBg.mix(foreground, 0.04f))
        v(sb, "editorCursor-foreground", editorFg)
        v(sb, "editorLineNumber-foreground", description)
        v(sb, "editorLineNumber-activeForeground", foreground)
        v(sb, "editorWhitespace-foreground", description.alpha(0.4f))
        v(sb, "editorIndentGuide-background", border)
        v(sb, "editorIndentGuide-activeBackground", focus.alpha(0.5f))
        v(sb, "editorRuler-foreground", border)

        // Sidebar & lists
        v(sb, "sideBar-background", sideBg)
        v(sb, "sideBar-foreground", foreground)
        v(sb, "sideBar-border", border)
        v(sb, "sideBarTitle-foreground", foreground)
        v(sb, "sideBarSectionHeader-background", sideHeaderBg)
        v(sb, "sideBarSectionHeader-foreground", foreground)
        v(sb, "list-hoverBackground", listHover)
        v(sb, "list-hoverForeground", foreground)
        v(sb, "list-activeSelectionBackground", listSelBg)
        v(sb, "list-activeSelectionForeground", listSelFg)
        v(sb, "list-inactiveSelectionBackground", listInactiveSel)
        v(sb, "list-inactiveSelectionForeground", foreground)
        v(sb, "list-focusBackground", listSelBg)
        v(sb, "list-highlightForeground", focus)

        // Activity & status
        v(sb, "activityBar-background", activityBg)
        v(sb, "activityBar-foreground", activityFg)
        v(sb, "activityBar-inactiveForeground", description)
        v(sb, "activityBar-border", border)
        v(sb, "activityBarBadge-background", activityBadgeBg)
        v(sb, "activityBarBadge-foreground", activityBadgeFg)
        v(sb, "statusBar-background", statusBg)
        v(sb, "statusBar-foreground", foreground)
        v(sb, "statusBar-border", border)
        v(sb, "statusBar-debuggingBackground", Color(0xCC, 0x66, 0x33))
        v(sb, "statusBar-noFolderBackground", statusBg)

        // Buttons & inputs
        v(sb, "button-background", buttonBg)
        v(sb, "button-foreground", buttonFg)
        v(sb, "button-hoverBackground", buttonHover)
        v(sb, "button-secondaryBackground", buttonBg.dim(0.85f))
        v(sb, "button-secondaryForeground", buttonFg)
        v(sb, "input-background", inputBg)
        v(sb, "input-foreground", inputFg)
        v(sb, "input-border", inputBorder)
        v(sb, "input-placeholderForeground", inputPlaceholder)
        v(sb, "inputOption-activeBackground", focus.alpha(0.2f))
        v(sb, "inputOption-activeBorder", focus)
        v(sb, "inputValidation-errorBackground", Color(0x5A, 0x1D, 0x1D))
        v(sb, "inputValidation-errorBorder", Color(0xBE, 0x11, 0x00))
        v(sb, "inputValidation-warningBackground", Color(0x35, 0x2A, 0x05))
        v(sb, "inputValidation-infoBackground", Color(0x06, 0x37, 0x4F))

        // Panels & tabs
        v(sb, "panel-background", panelBg)
        v(sb, "panel-border", border)
        v(sb, "panelTitle-activeBorder", focus)
        v(sb, "panelTitle-activeForeground", foreground)
        v(sb, "panelTitle-inactiveForeground", description)
        v(sb, "tab-activeBackground", panelBg)
        v(sb, "tab-activeForeground", foreground)
        v(sb, "tab-inactiveBackground", panelBg.dim(0.92f))
        v(sb, "tab-inactiveForeground", description)
        v(sb, "tab-border", border)
        v(sb, "tab-activeBorderTop", focus)
        v(sb, "editorGroupHeader-tabsBackground", panelBg)
        v(sb, "editorGroupHeader-tabsBorder", border)

        // Terminal
        v(sb, "terminal-background", editorBg)
        v(sb, "terminal-foreground", editorFg)
        v(sb, "terminal-ansiBlack", ansi[0])
        v(sb, "terminal-ansiRed", ansi[1])
        v(sb, "terminal-ansiGreen", ansi[2])
        v(sb, "terminal-ansiYellow", ansi[3])
        v(sb, "terminal-ansiBlue", ansi[4])
        v(sb, "terminal-ansiMagenta", ansi[5])
        v(sb, "terminal-ansiCyan", ansi[6])
        v(sb, "terminal-ansiWhite", ansi[7])
        v(sb, "terminal-ansiBrightBlack", ansi[8])
        v(sb, "terminal-ansiBrightRed", ansi[9])
        v(sb, "terminal-ansiBrightGreen", ansi[10])
        v(sb, "terminal-ansiBrightYellow", ansi[11])
        v(sb, "terminal-ansiBrightBlue", ansi[12])
        v(sb, "terminal-ansiBrightMagenta", ansi[13])
        v(sb, "terminal-ansiBrightCyan", ansi[14])
        v(sb, "terminal-ansiBrightWhite", ansi[15])

        // Diff & merge
        v(sb, "diffEditor-insertedTextBackground", diffAdded.alpha(0.4f))
        v(sb, "diffEditor-removedTextBackground", diffRemoved.alpha(0.4f))
        v(sb, "diffEditor-insertedLineBackground", diffAdded.alpha(0.25f))
        v(sb, "diffEditor-removedLineBackground", diffRemoved.alpha(0.25f))
        v(sb, "diffEditor-border", border)
        v(sb, "merge-currentHeaderBackground", diffAdded)
        v(sb, "merge-incomingHeaderBackground", diffModified)
        v(sb, "merge-commonHeaderBackground", panelBg)

        sb.append("}\n")
        return sb.toString()
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private fun ui(key: String): Color? = UIManager.getColor(key)

    private fun v(sb: StringBuilder, name: String, color: Color) {
        sb.append("  --vscode-").append(name).append(": ")
            .append(color.toCssRgba()).append(";\n")
    }

    private fun Color.toCssRgba(): String =
        if (alpha == 255) String.format("#%02x%02x%02x", red, green, blue)
        else "rgba($red, $green, $blue, ${"%.3f".format(alpha / 255f)})"

    private fun Color.dim(factor: Float): Color {
        // For dark themes "dim" means lighten; for light themes darken.
        val f = factor.coerceIn(0f, 1f)
        return if (JBColor.isBright()) {
            Color(
                (red * f).toInt().coerceIn(0, 255),
                (green * f).toInt().coerceIn(0, 255),
                (blue * f).toInt().coerceIn(0, 255),
                alpha,
            )
        } else {
            Color(
                (red + (255 - red) * (1 - f)).toInt().coerceIn(0, 255),
                (green + (255 - green) * (1 - f)).toInt().coerceIn(0, 255),
                (blue + (255 - blue) * (1 - f)).toInt().coerceIn(0, 255),
                alpha,
            )
        }
    }

    private fun Color.mix(other: Color, t: Float): Color {
        val k = t.coerceIn(0f, 1f)
        return Color(
            (red * (1 - k) + other.red * k).toInt().coerceIn(0, 255),
            (green * (1 - k) + other.green * k).toInt().coerceIn(0, 255),
            (blue * (1 - k) + other.blue * k).toInt().coerceIn(0, 255),
            alpha,
        )
    }

    private fun Color.alpha(a: Float): Color =
        Color(red, green, blue, (a.coerceIn(0f, 1f) * 255).toInt())

    private fun textOn(c: Color): Color {
        val luma = (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) / 255.0
        return if (luma > 0.55) Color.BLACK else Color.WHITE
    }

    /** Standard 16-color ANSI palette (xterm). */
    private fun ansiPalette(): Array<Color> = arrayOf(
        Color(0x00, 0x00, 0x00), // black
        Color(0xCD, 0x31, 0x31), // red
        Color(0x0D, 0xBC, 0x79), // green
        Color(0xE5, 0xE5, 0x10), // yellow
        Color(0x24, 0x72, 0xC8), // blue
        Color(0xBC, 0x3F, 0xBC), // magenta
        Color(0x11, 0xA8, 0xCD), // cyan
        Color(0xE5, 0xE5, 0xE5), // white
        Color(0x66, 0x66, 0x66), // bright black
        Color(0xF1, 0x4C, 0x4C), // bright red
        Color(0x23, 0xD1, 0x8B), // bright green
        Color(0xF5, 0xF5, 0x43), // bright yellow
        Color(0x3B, 0x8E, 0xEA), // bright blue
        Color(0xD6, 0x70, 0xD6), // bright magenta
        Color(0x29, 0xB8, 0xDB), // bright cyan
        Color(0xFF, 0xFF, 0xFF), // bright white
    )
}
