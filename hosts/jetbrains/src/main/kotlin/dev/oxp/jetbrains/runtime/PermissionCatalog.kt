package dev.oxp.jetbrains.runtime

/**
 * Canonical capability catalog mirrored from
 * `packages/types/src/permissions.ts`. Keep these two in sync — the
 * registry server validates against the TS list and the host UI shows
 * the same descriptions.
 *
 * `sensitive` capabilities re-prompt on each use; `verifiedOnly` cannot
 * be granted to extensions whose publisher isn't domain-verified once
 * Phase B.1b lands.
 */
data class CapabilityInfo(
    val id: String,
    val description: String,
    val sensitive: Boolean = false,
    val verifiedOnly: Boolean = false,
)

object PermissionCatalog {
    val ALL: List<CapabilityInfo> = listOf(
        CapabilityInfo("fs.read",              "Read files on your machine"),
        CapabilityInfo("fs.write",             "Write files on your machine"),
        CapabilityInfo("fs.delete",            "Delete files on your machine", sensitive = true),
        CapabilityInfo("fs.watch",             "Watch files for changes"),
        CapabilityInfo("workspace.read",       "Read files in your open project"),
        CapabilityInfo("workspace.write",      "Modify files in your open project"),
        CapabilityInfo("net.fetch",            "Make network requests"),
        CapabilityInfo("clipboard.read",       "Read your clipboard contents", sensitive = true),
        CapabilityInfo("clipboard.write",      "Replace your clipboard contents"),
        CapabilityInfo("notifications.show",   "Show desktop notifications"),
        CapabilityInfo("secrets.read",         "Read its own stored secrets",  sensitive = true),
        CapabilityInfo("secrets.write",        "Store secrets in your keychain", sensitive = true),
        CapabilityInfo("events.publish",       "Send events to other extensions"),
        CapabilityInfo("events.subscribe",     "Receive events from other extensions"),
        CapabilityInfo("commands.executeHost", "Run editor actions on your behalf"),
        CapabilityInfo("terminal.spawn",       "Start new processes on your machine", sensitive = true, verifiedOnly = true),
        CapabilityInfo("terminal.shell",       "Run shell commands on your machine",  sensitive = true, verifiedOnly = true),
        CapabilityInfo("process.kill",         "Terminate processes on your machine", sensitive = true, verifiedOnly = true),
    )
}
