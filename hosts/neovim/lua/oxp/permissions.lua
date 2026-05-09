-- Permission scope matcher for OXP capability gating on Neovim.
--
-- Manifest permissions look like:
--   "fs.read:./**"
--   "fs.write:/tmp/scratch/*"
--   "net.fetch:https://api.example.com/*"
--   "secrets.read"           (scopeless)
--   "commands.executeHost"   (scopeless)
--
-- v0.1 semantics (kept intentionally simple — must match the JetBrains
-- host's PermissionScope.kt so an extension that runs there runs here):
--   * `**` / `*` / `./**` → "any path the user agreed to" (host-level
--     consent narrows this; tighter glob enforcement is v0.2)
--   * otherwise prefix match (with a leading "./" stripped)
--   * URL scopes: `*` is converted to `.*` in a regex match against
--     the full request URL. `*` alone matches anything.

local M = {}

---@param perms string[]
---@param group string
---@return string[] scopes for this permission group
local function scopes_for(perms, group)
  local out = {}
  for _, p in ipairs(perms) do
    local colon = p:find(":", 1, true)
    if colon then
      if p:sub(1, colon - 1) == group then
        table.insert(out, p:sub(colon + 1))
      end
    end
  end
  return out
end

local function fs_scope_matches(scope, path)
  if scope == "**" or scope == "*" or scope == "./**" then
    return true
  end
  local normalized = scope:gsub("/%*%*$", "")
  if normalized:sub(1, 2) == "./" then normalized = normalized:sub(3) end
  return path:sub(1, #normalized) == normalized
end

local function url_scope_matches(scope, url)
  if scope == "*" then return true end
  -- Escape regex specials, then turn `*` back into `.*`.
  local pattern = scope
    :gsub("([%^%$%(%)%%%.%[%]%+%-%?])", "%%%1")
    :gsub("%*", ".*")
  return url:match("^" .. pattern .. "$") ~= nil
end

---@param group "fs.read"|"fs.write"|"fs.delete"
function M.fs_allows(group, path, perms)
  for _, scope in ipairs(scopes_for(perms, group)) do
    if fs_scope_matches(scope, path) then return true end
  end
  return false
end

function M.net_allows(url, perms)
  for _, scope in ipairs(scopes_for(perms, "net.fetch")) do
    if url_scope_matches(scope, url) then return true end
  end
  return false
end

---Scopeless permissions (`secrets.read`, `secrets.write`, `commands.executeHost`).
function M.has(group, perms)
  for _, p in ipairs(perms) do
    if p == group or p:sub(1, #group + 1) == group .. ":" then
      return true
    end
  end
  return false
end

return M
