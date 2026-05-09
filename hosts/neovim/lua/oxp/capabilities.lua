-- Runtime → host capability handlers for the Neovim adapter.
--
-- Each function corresponds to a JSON-RPC method the runtime invokes
-- after the host advertised the capability in `initialize`. Method
-- names are locked by `spec/v1/host-runtime-rpc.md` §6.1–§6.2 and
-- must stay in sync with the JetBrains host (`CapabilityHandlers.kt`)
-- and the runtime emitter (`runtime/src/wasm.rs`).
--
-- Wire conventions:
--   * bytes (`storage` values, `fs` body, `net.fetch` body) are base64
--     strings on the wire
--   * headers are `[[name, value], …]` pairs
--   * params include `extensionId` + `instanceId` for routing
--   * permission denials throw via the dispatcher with code -32004 +
--     `data = { scope = "<group>:<scope>" }`
--
-- Storage layout: <hostStorePath>/storage/<extId>/<hex(key)>
--
-- Secrets are kept in-memory only — the Neovim host advertises
-- `secrets.store = "memory"` so extensions know not to expect
-- persistence. Future work: integrate with `pass`/`keyring`.

local perm = require("oxp.permissions")

local M = {}

local uv = vim.uv or vim.loop

---@class LoadedExtension
---@field instance_id string
---@field extension_id string
---@field permissions string[]
---@field host_store_path string

---@type table<string, LoadedExtension>
local instances = {}
---@type table<string, table<string, string>>  extId -> key -> value
local secrets_mem = {}

-- ──────────────────────────────────────────────────────────────────
-- registry
-- ──────────────────────────────────────────────────────────────────

function M.register(loaded) instances[loaded.instance_id] = loaded end
function M.unregister(instance_id)
  instances[instance_id] = nil
end

local function lookup(params)
  local id = params and params.instanceId
  if type(id) ~= "string" then
    error({ code = -32602, message = "missing instanceId" })
  end
  local inst = instances[id]
  if not inst then
    error({ code = -32008, message = "unknown instance: " .. id })
  end
  return inst
end

local function deny(scope, message)
  error({ code = -32004, message = message or (scope .. " denied"),
          data = { scope = scope } })
end

-- ──────────────────────────────────────────────────────────────────
-- base64 (RFC 4648, no line wrap) — pure Lua, no FFI
-- ──────────────────────────────────────────────────────────────────

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_DECODE = {}
for i = 1, #B64 do B64_DECODE[B64:sub(i, i)] = i - 1 end

local function b64encode(s)
  if s == nil or s == "" then return "" end
  local out = {}
  local len = #s
  for i = 1, len, 3 do
    local a, b, c = s:byte(i), s:byte(i + 1) or 0, s:byte(i + 2) or 0
    local n = a * 65536 + b * 256 + c
    local b1 = math.floor(n / 262144) % 64
    local b2 = math.floor(n / 4096) % 64
    local b3 = math.floor(n / 64) % 64
    local b4 = n % 64
    out[#out + 1] = B64:sub(b1 + 1, b1 + 1)
    out[#out + 1] = B64:sub(b2 + 1, b2 + 1)
    out[#out + 1] = (i + 1 <= len) and B64:sub(b3 + 1, b3 + 1) or "="
    out[#out + 1] = (i + 2 <= len) and B64:sub(b4 + 1, b4 + 1) or "="
  end
  return table.concat(out)
end

local function b64decode(s)
  if not s or s == "" then return "" end
  s = s:gsub("[^A-Za-z0-9+/=]", "")
  local out = {}
  for i = 1, #s, 4 do
    local c1 = B64_DECODE[s:sub(i, i)] or 0
    local c2 = B64_DECODE[s:sub(i + 1, i + 1)] or 0
    local c3s = s:sub(i + 2, i + 2)
    local c4s = s:sub(i + 3, i + 3)
    local c3 = B64_DECODE[c3s] or 0
    local c4 = B64_DECODE[c4s] or 0
    local n = c1 * 262144 + c2 * 4096 + c3 * 64 + c4
    out[#out + 1] = string.char(math.floor(n / 65536) % 256)
    if c3s ~= "=" then out[#out + 1] = string.char(math.floor(n / 256) % 256) end
    if c4s ~= "=" then out[#out + 1] = string.char(n % 256) end
  end
  return table.concat(out)
end

-- ──────────────────────────────────────────────────────────────────
-- filesystem helpers
-- ──────────────────────────────────────────────────────────────────

local function mkdir_p(path)
  if vim.fn.isdirectory(path) == 1 then return end
  vim.fn.mkdir(path, "p")
end

local function read_all(path)
  local fd, oerr = uv.fs_open(path, "r", 420)
  if not fd then return nil, oerr end
  local stat = uv.fs_fstat(fd)
  local data = uv.fs_read(fd, stat.size, 0) or ""
  uv.fs_close(fd)
  return data
end

local function write_all(path, data)
  local fd = assert(uv.fs_open(path, "w", 420))
  if data ~= "" then uv.fs_write(fd, data, 0) end
  uv.fs_close(fd)
end

local function hex_encode(s)
  return (s:gsub(".", function(c) return string.format("%02x", c:byte()) end))
end

local function hex_decode(s)
  return (s:gsub("..", function(h) return string.char(tonumber(h, 16)) end))
end

local function safe_id(s)
  return (s:gsub("[^%w%-%_%.]", "_"))
end

-- ──────────────────────────────────────────────────────────────────
-- log/write (notification)
-- ──────────────────────────────────────────────────────────────────

function M.log_write(params)
  local level = params.level or "info"
  local msg = params.message or ""
  local ext = params.extensionId or "ext"
  local mapped = ({
    error = vim.log.levels.ERROR,
    warn  = vim.log.levels.WARN,
    info  = vim.log.levels.INFO,
    debug = vim.log.levels.DEBUG,
    trace = vim.log.levels.TRACE,
  })[level] or vim.log.levels.INFO
  vim.notify(("[%s] %s"):format(ext, msg), mapped)
end

-- ──────────────────────────────────────────────────────────────────
-- storage
-- ──────────────────────────────────────────────────────────────────

local function storage_dir(loaded)
  local dir = loaded.host_store_path .. "/storage/" .. safe_id(loaded.extension_id)
  mkdir_p(dir)
  return dir
end

function M.storage_get(params)
  local loaded = lookup(params)
  local key = params.key or error({ code = -32602, message = "missing key" })
  local file = storage_dir(loaded) .. "/" .. hex_encode(key)
  if vim.fn.filereadable(file) == 0 then return { value = vim.NIL } end
  local bytes = read_all(file) or ""
  return { value = b64encode(bytes) }
end

function M.storage_set(params)
  local loaded = lookup(params)
  local key = params.key or error({ code = -32602, message = "missing key" })
  local b64 = params.value or ""
  write_all(storage_dir(loaded) .. "/" .. hex_encode(key), b64decode(b64))
  return vim.empty_dict()
end

function M.storage_delete(params)
  local loaded = lookup(params)
  local key = params.key or error({ code = -32602, message = "missing key" })
  uv.fs_unlink(storage_dir(loaded) .. "/" .. hex_encode(key))
  return vim.empty_dict()
end

function M.storage_keys(params)
  local loaded = lookup(params)
  local dir = storage_dir(loaded)
  local keys = {}
  local handle = uv.fs_scandir(dir)
  if handle then
    while true do
      local name = uv.fs_scandir_next(handle)
      if not name then break end
      table.insert(keys, hex_decode(name))
    end
  end
  return { keys = keys }
end

-- ──────────────────────────────────────────────────────────────────
-- filesystem (gated)
-- ──────────────────────────────────────────────────────────────────

local function require_fs(loaded, group, path)
  if not perm.fs_allows(group, path, loaded.permissions) then
    deny(group .. ":" .. path, group .. " denied for " .. path)
  end
end

function M.fs_read_file(params)
  local loaded = lookup(params)
  local path = params.path or error({ code = -32602, message = "missing path" })
  require_fs(loaded, "fs.read", path)
  if vim.fn.filereadable(path) == 0 then
    error({ code = -32603, message = "not found", data = { kind = "notFound" } })
  end
  local bytes = read_all(path) or ""
  return { bytes = b64encode(bytes) }
end

function M.fs_write_file(params)
  local loaded = lookup(params)
  local path = params.path or error({ code = -32602, message = "missing path" })
  require_fs(loaded, "fs.write", path)
  local b64 = params.bytes or ""
  local parent = vim.fn.fnamemodify(path, ":h")
  if parent ~= "" and parent ~= "." then mkdir_p(parent) end
  write_all(path, b64decode(b64))
  return vim.empty_dict()
end

function M.fs_delete(params)
  local loaded = lookup(params)
  local path = params.path or error({ code = -32602, message = "missing path" })
  require_fs(loaded, "fs.delete", path)
  uv.fs_unlink(path)
  return vim.empty_dict()
end

function M.fs_stat(params)
  local loaded = lookup(params)
  local path = params.path or error({ code = -32602, message = "missing path" })
  require_fs(loaded, "fs.read", path)
  local stat = uv.fs_stat(path)
  if not stat then
    error({ code = -32603, message = "not found", data = { kind = "notFound" } })
  end
  return {
    size = stat.size,
    isDir = stat.type == "directory",
    mtimeMs = math.floor((stat.mtime.sec or 0) * 1000 + (stat.mtime.nsec or 0) / 1e6),
  }
end

function M.fs_list_dir(params)
  local loaded = lookup(params)
  local path = params.path or error({ code = -32602, message = "missing path" })
  require_fs(loaded, "fs.read", path)
  local entries = {}
  local handle = uv.fs_scandir(path)
  if not handle then
    error({ code = -32603, message = "not found", data = { kind = "notFound" } })
  end
  while true do
    local name = uv.fs_scandir_next(handle)
    if not name then break end
    table.insert(entries, name)
  end
  return { entries = entries }
end

-- ──────────────────────────────────────────────────────────────────
-- net.fetch (gated, synchronous over curl)
-- ──────────────────────────────────────────────────────────────────

-- We shell out to `curl` rather than implementing TLS in pure Lua. This
-- keeps the host adapter dependency-free except for a tool every dev
-- machine ships with. Body bytes round-trip through stdin/stdout to
-- preserve binary safety.
function M.net_fetch(params)
  local loaded = lookup(params)
  local url = params.url or error({ code = -32602, message = "missing url" })
  if not perm.net_allows(url, loaded.permissions) then
    deny("net.fetch:" .. url, "net.fetch denied for " .. url)
  end
  local method = (params.method or "GET"):upper()
  local headers = params.headers or {}
  local body_b64 = params.body
  local body_bytes = (body_b64 ~= nil and body_b64 ~= vim.NIL) and b64decode(body_b64) or nil

  local args = {
    "curl", "-sS", "--max-time", "30",
    "-D", "-",            -- write headers to stdout before the body
    "-o", "-",            -- write body to stdout
    "-X", method,
  }
  for _, h in ipairs(headers) do
    if type(h) == "table" and h[1] and h[2] then
      table.insert(args, "-H")
      table.insert(args, h[1] .. ": " .. h[2])
    end
  end
  if body_bytes then
    table.insert(args, "--data-binary")
    table.insert(args, "@-")
  end
  table.insert(args, url)

  local res = vim.system(args, {
    text = false,
    stdin = body_bytes,
    timeout = 35000,
  }):wait()

  if res.code ~= 0 then
    if res.code == 28 then
      error({ code = -32603, message = "timeout", data = { kind = "timeout" } })
    end
    error({ code = -32603, message = "transport: " .. (res.stderr or "exit " .. res.code) })
  end

  -- Parse leading header block(s). curl emits one block per response,
  -- including any redirects we followed; the last block applies.
  local raw = res.stdout or ""
  local sep = "\r\n\r\n"
  local headers_end, body_start = raw:find(sep, 1, true)
  while true do
    local next_sep = raw:find(sep, (body_start or 0) + 1, true)
    if not next_sep then break end
    headers_end = next_sep
    body_start = headers_end + #sep - 1
  end
  if not headers_end then
    error({ code = -32603, message = "transport: malformed response" })
  end
  local header_text = raw:sub(1, headers_end - 1)
  local body = raw:sub(body_start + 1)

  local status = tonumber(header_text:match("^HTTP/[%d%.]+%s+(%d+)")) or 0
  local hdrs = {}
  for line in header_text:gmatch("[^\r\n]+") do
    local k, v = line:match("^([^:]+):%s*(.*)$")
    if k and v then table.insert(hdrs, { k, v }) end
  end

  return {
    status = status,
    headers = hdrs,
    body = b64encode(body),
  }
end

-- ──────────────────────────────────────────────────────────────────
-- secrets (in-memory; capability declares store="memory")
-- ──────────────────────────────────────────────────────────────────

function M.secrets_get(params)
  local loaded = lookup(params)
  if not perm.has("secrets.read", loaded.permissions) then
    deny("secrets.read")
  end
  local key = params.key or error({ code = -32602, message = "missing key" })
  local bag = secrets_mem[loaded.extension_id] or {}
  local v = bag[key]
  return { value = v == nil and vim.NIL or v }
end

function M.secrets_set(params)
  local loaded = lookup(params)
  if not perm.has("secrets.write", loaded.permissions) then
    deny("secrets.write")
  end
  local key = params.key or error({ code = -32602, message = "missing key" })
  local value = params.value or error({ code = -32602, message = "missing value" })
  secrets_mem[loaded.extension_id] = secrets_mem[loaded.extension_id] or {}
  secrets_mem[loaded.extension_id][key] = value
  return vim.empty_dict()
end

function M.secrets_delete(params)
  local loaded = lookup(params)
  if not perm.has("secrets.write", loaded.permissions) then
    deny("secrets.write")
  end
  local key = params.key or error({ code = -32602, message = "missing key" })
  local bag = secrets_mem[loaded.extension_id]
  if bag then bag[key] = nil end
  return vim.empty_dict()
end

-- ──────────────────────────────────────────────────────────────────
-- commands (gated)
-- ──────────────────────────────────────────────────────────────────

-- Extensions can register Lua callbacks under `commands.executeHost`
-- by putting them here; alternatively the commandId is interpreted as
-- a `:`-style ex-command (e.g. "edit foo.txt").
M._registered_commands = {}

function M.register_command(id, fn)
  M._registered_commands[id] = fn
end

function M.commands_execute(params)
  local loaded = lookup(params)
  if not perm.has("commands.executeHost", loaded.permissions) then
    deny("commands.executeHost")
  end
  local id = params.commandId or error({ code = -32602, message = "missing commandId" })
  local args_json = params.argsJson or "null"
  local ok_decode, args = pcall(vim.json.decode, args_json)
  if not ok_decode then args = nil end

  local fn = M._registered_commands[id]
  local result
  if fn then
    local ok, ret = pcall(fn, args)
    if not ok then
      error({ code = -32603, message = "command threw: " .. tostring(ret) })
    end
    result = ret
  else
    -- Fall back to ex-command. We don't surface a return value.
    local ok, err = pcall(vim.cmd, id)
    if not ok then
      error({ code = -32603, message = "unknown command: " .. id .. " (" .. tostring(err) .. ")" })
    end
    result = vim.NIL
  end
  return { resultJson = vim.json.encode(result == nil and vim.NIL or result) }
end

-- ──────────────────────────────────────────────────────────────────
-- ui/render, ui/setStatus (notifications) and ui/notify (request)
-- ──────────────────────────────────────────────────────────────────

-- Render is fire-and-forget — the runtime owns the diff. For the
-- protocol-validation host we just stash the latest tree per instance
-- so a future surface mapping can pick it up.
M._latest_render = {}
M._latest_status = {}

function M.ui_render(params)
  M._latest_render[params.instanceId or ""] = params.treeJson or ""
end

function M.ui_set_status(params)
  M._latest_status[params.instanceId or ""] = {
    text = params.text or "",
    tooltip = params.tooltip,
  }
end

-- ui/notify is a request — the runtime expects {choice} back.
-- `vim.ui.select` is async; we wrap it with a coroutine so the
-- dispatcher can suspend until a choice is made. The dispatcher
-- (`oxp.init`) recognises the `coroutine` return type and defers
-- the JSON-RPC response.
function M.ui_notify_async(params, respond)
  local actions = params.actions or {}
  local message = params.message or ""
  if #actions == 0 then
    -- Plain notify: never returns a choice.
    local level = ({
      error = vim.log.levels.ERROR,
      warn  = vim.log.levels.WARN,
    })[params.level or "info"] or vim.log.levels.INFO
    vim.notify(message, level)
    respond({ choice = vim.NIL })
    return
  end
  vim.ui.select(actions, { prompt = message }, function(choice)
    respond({ choice = choice == nil and vim.NIL or choice })
  end)
end

return M
