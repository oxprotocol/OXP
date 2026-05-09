package dev.oxp.jetbrains.host

// Manifest permission strings have shape `<group>:<scope>` — e.g.
// `fs.read:./**`, `net.fetch:https://api.example.com/<path>`. Some groups
// (secrets.read, secrets.write, commands.executeHost) are scope-less.
//
// Scope syntax (v0.1):
//   - `**`        — match anything inside this segment + below
//   - `*`         — match anything inside this segment
//   - leading `./`— relative to workspace/project root (we treat it
//                   as "any absolute path" for now since the runtime
//                   doesn't yet pass workspace context). Prefix-only
//                   enforcement until v0.2.
//   - everything else compares as a literal prefix
//
// For URLs (`net.fetch:`) the scope is matched against the request URL.
// A trailing `*` means "any path"; literal characters compare as-is.
object PermissionScope {

    fun fsAllows(group: String, path: String, perms: List<String>): Boolean {
        // `group` is one of: fs.read, fs.write, fs.delete
        val scopes = perms.mapNotNull { p ->
            val ix = p.indexOf(':')
            if (ix < 0) null
            else if (p.substring(0, ix) == group) p.substring(ix + 1) else null
        }
        return scopes.any { fsScopeMatches(it, path) }
    }

    fun netAllows(url: String, perms: List<String>): Boolean {
        val scopes = perms.mapNotNull { p ->
            val ix = p.indexOf(':')
            if (ix < 0) null
            else if (p.substring(0, ix) == "net.fetch") p.substring(ix + 1) else null
        }
        return scopes.any { urlScopeMatches(it, url) }
    }

    fun has(group: String, perms: List<String>): Boolean =
        perms.any { it == group || it.startsWith("$group:") }

    private fun fsScopeMatches(scope: String, path: String): Boolean {
        // Conservative v0.1 behaviour: `./` and `**` mean "anywhere on disk
        // the user agreed to." We rely on the host-level grant prompt to
        // narrow this; once we plumb workspace root we'll tighten it.
        if (scope == "./**" || scope == "**" || scope == "*") return true
        // Literal prefix match (no glob expansion in v0.1 beyond above).
        val normalized = if (scope.endsWith("/**")) scope.removeSuffix("/**") else scope
        return path.startsWith(normalized.removePrefix("./"))
    }

    private fun urlScopeMatches(scope: String, url: String): Boolean {
        if (scope == "*") return true
        // Wildcard `*` inside path. `https://api.example.com/*` matches any path.
        // Translate to a regex: escape, then convert `\*` back to `.*`.
        val regex = Regex(
            "^" +
                scope
                    .replace(".", "\\.")
                    .replace("?", "\\?")
                    .replace("*", ".*") +
                "$"
        )
        return regex.matches(url)
    }
}
