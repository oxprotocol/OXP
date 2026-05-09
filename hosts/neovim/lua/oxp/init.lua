-- oxp.nvim — Neovim host adapter for the OXP universal extension protocol.
--
-- Spawns the `oxp-runtime` binary as a child process, speaks JSON-RPC 2.0
-- with LSP-style `Content-Length` framing over stdio (see
-- `spec/v1/host-runtime-rpc.md`), and bridges the runtime's lifecycle
-- methods to Neovim. Pure Lua, no external deps beyond stdlib + libuv
-- (which Neovim ships).
--
-- Usage from a user's init.lua:
--
--   require("oxp").setup({
--     runtime = "/abs/path/to/oxp-runtime",   -- required, no default
--     log_level = "info",                     -- "trace"|"debug"|"info"|"warn"|"error"
--   })
--
--   require("oxp").install("/abs/path/to/extension.wasm")
--   require("oxp").command("ext-d92800", "hello.greet", { name = "world" })
--
-- This module is the protocol-validation host: minimal but real. It
-- proves a non-VS-Code IDE can drive `oxp-runtime` with no changes to
-- the runtime binary.

local capabilities = require("oxp.capabilities")

local M = {}

---@class OxpConfig
---@field runtime string  Path to the oxp-runtime binary.
---@field log_level? string

---@type OxpConfig|nil
local config = nil

---@type table  jsonrpc id -> function(result, err)
local pending = {}
---@type integer
local next_id = 1
---@type uv_pipe_t|nil
local stdin = nil
---@type uv_pipe_t|nil
local stdout = nil
---@type uv_pipe_t|nil
local stderr = nil
---@type uv_process_t|nil
local handle = nil
---@type integer|nil
local pid = nil
---@type boolean
local initialized = false
---@type table  extensionId -> instanceId
local instances = {}

local uv = vim.uv or vim.loop

-- ──────────────────────────────────────────────────────────────────
-- framing
-- ──────────────────────────────────────────────────────────────────

local function encode_frame(obj)
  local body = vim.json.encode(obj)
  return ("Content-Length: %d\r\n\r\n%s"):format(#body, body)
end

-- Stream parser. Buffers raw stdout bytes until a complete LSP frame is
-- assembled, then yields the decoded JSON to `on_message`.
local function make_parser(on_message)
  local buf = ""
  return function(chunk)
    buf = buf .. chunk
    while true do
      local header_end = buf:find("\r\n\r\n", 1, true)
      if not header_end then return end
      local headers = buf:sub(1, header_end - 1)
      local len = headers:match("[Cc]ontent%-[Ll]ength:%s*(%d+)")
      if not len then
        vim.schedule(function()
          vim.notify("oxp: malformed frame headers: " .. headers, vim.log.levels.ERROR)
        end)
        buf = ""
        return
      end
      len = tonumber(len)
      local body_start = header_end + 4
      if #buf < body_start + len - 1 then return end
      local body = buf:sub(body_start, body_start + len - 1)
      buf = buf:sub(body_start + len)
      local ok, decoded = pcall(vim.json.decode, body)
      if ok then
        on_message(decoded)
      else
        vim.schedule(function()
          vim.notify("oxp: JSON decode failed: " .. tostring(decoded), vim.log.levels.ERROR)
        end)
      end
    end
  end
end

-- ──────────────────────────────────────────────────────────────────
-- transport
-- ──────────────────────────────────────────────────────────────────

local function send_raw(obj)
  if not stdin then
    error("oxp: runtime not started")
  end
  stdin:write(encode_frame(obj))
end

---@param method string
---@param params table|nil
---@param cb fun(result: any|nil, err: any|nil)
local function request(method, params, cb)
  local id = next_id
  next_id = next_id + 1
  pending[id] = cb
  send_raw({ jsonrpc = "2.0", id = id, method = method, params = params })
end

---@param method string
---@param params table|nil
local function notify(method, params)
  send_raw({ jsonrpc = "2.0", method = method, params = params })
end

-- Inbound dispatcher. Handles three message classes:
--   * Response to one of our outbound requests (has `id` + result/error)
--   * Notification from the runtime (has `method`, no `id`)
--   * Request from the runtime (has `id` + `method`) — we answer the
--     few host RPCs the runtime is allowed to make
local function on_message(msg)
  if msg.id ~= nil and (msg.result ~= nil or msg.error ~= nil) and msg.method == nil then
    local cb = pending[msg.id]
    pending[msg.id] = nil
    if cb then
      vim.schedule(function() cb(msg.result, msg.error) end)
    end
    return
  end

  if msg.method then
    if msg.id == nil then
      -- notification from runtime
      vim.schedule(function() M._on_notification(msg.method, msg.params) end)
    else
      -- request from runtime — dispatch on the main loop so handlers
      -- can call into Neovim API safely. Some handlers (ui/notify)
      -- are async; they call `respond` themselves.
      local id = msg.id
      local function respond(result, err)
        if err then
          send_raw({ jsonrpc = "2.0", id = id, error = err })
        else
          send_raw({ jsonrpc = "2.0", id = id, result = result })
        end
      end
      vim.schedule(function() M._on_request(msg.method, msg.params, respond) end)
    end
  end
end

-- ──────────────────────────────────────────────────────────────────
-- host capability descriptor (sent in `initialize`)
-- ──────────────────────────────────────────────────────────────────

local function host_capabilities()
  return {
    ui = {
      webview      = false,        -- no embedded chromium
      treeView     = false,        -- could map to a side buffer; later
      statusBar    = true,         -- statusline integration
      notification = true,         -- vim.notify
      quickPick    = true,         -- vim.ui.select
      inputBox     = true,         -- vim.ui.input
    },
    language = {
      completions    = true,
      hover          = true,
      codeLens       = true,
      diagnostics    = true,
      definition     = true,
      references     = true,
      rename         = true,
      formatting     = true,
      languageServer = true,       -- vim.lsp client
    },
    editor = {
      buffers      = true,
      decorations  = true,         -- nvim_buf_set_extmark
      selection    = true,
      virtualText  = true,         -- extmarks virt_text
    },
    fs       = { workspaceScoped = true },
    process  = { spawn = false },  -- runtime sandbox should own this
    secrets  = { store = "memory" }, -- TODO: integrate with `pass` / `keyring`
    debugger = { dap = false },     -- nvim-dap is third-party, off by default
    terminal = { create = true },   -- :terminal
  }
end

-- ──────────────────────────────────────────────────────────────────
-- inbound runtime → host
-- ──────────────────────────────────────────────────────────────────

function M._on_notification(method, params)
  if method == "log/write" then
    capabilities.log_write(params or {})
    return
  end
  if method == "ui/render" then
    capabilities.ui_render(params or {})
    return
  end
  if method == "ui/setStatus" then
    capabilities.ui_set_status(params or {})
    return
  end
  if method == "stream/data" or method == "stream/open" or method == "stream/close" then
    -- Phase: streams not implemented in Neovim host yet.
    return
  end
  if method == "surface/render" then
    -- Phase: UI surfaces will land with the actual UI mapping work.
    return
  end
  -- Unknown notifications are ignored per JSON-RPC 2.0.
end

-- Synchronous request handlers, keyed by method name. Each takes
-- `params` and returns the result table. Errors are raised via
-- `error({ code, message, data })` and translated to JSON-RPC errors.
local sync_handlers = {
  ["storage/get"]      = capabilities.storage_get,
  ["storage/set"]      = capabilities.storage_set,
  ["storage/delete"]   = capabilities.storage_delete,
  ["storage/keys"]     = capabilities.storage_keys,
  ["fs/readFile"]      = capabilities.fs_read_file,
  ["fs/writeFile"]     = capabilities.fs_write_file,
  ["fs/delete"]        = capabilities.fs_delete,
  ["fs/stat"]          = capabilities.fs_stat,
  ["fs/listDir"]       = capabilities.fs_list_dir,
  ["net/fetch"]        = capabilities.net_fetch,
  ["secrets/get"]      = capabilities.secrets_get,
  ["secrets/set"]      = capabilities.secrets_set,
  ["secrets/delete"]   = capabilities.secrets_delete,
  ["commands/execute"] = capabilities.commands_execute,
}

local function rpc_error_from(err, fallback_message)
  if type(err) == "table" and err.code then return err end
  return { code = -32603, message = fallback_message .. ": " .. tostring(err) }
end

---Dispatcher for runtime → host requests. Most are synchronous; a few
---(ui/notify) are async and call `respond` themselves.
---@param method string
---@param params table
---@param respond fun(result: any|nil, err: table|nil)
function M._on_request(method, params, respond)
  params = params or {}
  if method == "ui/notify" then
    local ok, err = pcall(capabilities.ui_notify_async, params, function(result)
      respond(result, nil)
    end)
    if not ok then
      respond(nil, rpc_error_from(err, "ui/notify failed"))
    end
    return
  end

  local handler = sync_handlers[method]
  if not handler then
    respond(nil, { code = -32601, message = "Method not found: " .. method })
    return
  end
  local ok, result = pcall(handler, params)
  if ok then
    respond(result, nil)
  else
    respond(nil, rpc_error_from(result, method .. " failed"))
  end
end

---Register a Lua callback for `commands/execute` (gated behind
---`commands.executeHost` permission). Otherwise the runtime's
---commandId is interpreted as a `:`-style ex-command.
---@param command_id string
---@param fn fun(args: any): any
function M.register_command(command_id, fn)
  capabilities.register_command(command_id, fn)
end

-- ──────────────────────────────────────────────────────────────────
-- public API
-- ──────────────────────────────────────────────────────────────────

---@param cfg OxpConfig
function M.setup(cfg)
  assert(cfg and cfg.runtime, "oxp.setup{ runtime = '<path to oxp-runtime>' } is required")
  config = cfg
end

---Spawn the runtime process and complete the `initialize` handshake.
---@param cb fun(err: string|nil)
function M.start(cb)
  cb = cb or function() end
  if handle then return cb(nil) end
  assert(config, "oxp.setup() must be called first")

  stdin  = uv.new_pipe(false)
  stdout = uv.new_pipe(false)
  stderr = uv.new_pipe(false)

  local env = { "OXP_LOG=" .. (config.log_level or "info") }
  for k, v in pairs(uv.os_environ()) do
    if k ~= "OXP_LOG" then table.insert(env, k .. "=" .. v) end
  end

  local h, p = uv.spawn(config.runtime, {
    args = { "--host", "neovim" },
    stdio = { stdin, stdout, stderr },
    env = env,
  }, function(code, signal)
    vim.schedule(function()
      vim.notify(("oxp-runtime exited (code=%s signal=%s)"):format(code, signal),
        code == 0 and vim.log.levels.INFO or vim.log.levels.WARN)
    end)
    handle, pid, stdin, stdout, stderr = nil, nil, nil, nil, nil
    initialized = false
  end)

  if not h then
    return cb("failed to spawn " .. config.runtime .. ": " .. tostring(p))
  end
  handle, pid = h, p

  local parser = make_parser(on_message)
  stdout:read_start(function(err, chunk)
    if err then
      vim.schedule(function() vim.notify("oxp stdout err: " .. err, vim.log.levels.ERROR) end)
      return
    end
    if chunk then parser(chunk) end
  end)

  -- Pipe runtime stderr into :messages for visibility.
  stderr:read_start(function(err, chunk)
    if err or not chunk then return end
    vim.schedule(function()
      for line in chunk:gmatch("[^\r\n]+") do
        vim.api.nvim_echo({ { "[oxp-runtime] " .. line, "Comment" } }, false, {})
      end
    end)
  end)

  request("initialize", {
    protocolVersion = "1.0",
    host = {
      id = "neovim",
      version = tostring(vim.version()),
      platform = jit and jit.os:lower() .. "-" .. jit.arch:lower() or "unknown",
    },
    capabilities = host_capabilities(),
    hostStorePath = vim.fn.stdpath("data") .. "/oxp",
  }, function(result, rpcerr)
    if rpcerr then
      return cb("initialize failed: " .. vim.inspect(rpcerr))
    end
    initialized = true
    vim.notify(("oxp-runtime %s ready (engine=%s)"):format(
      result.runtimeVersion, result.wasmEngine), vim.log.levels.INFO)
    cb(nil)
  end)
end

---Load + activate an extension from a .wasm path or bundle directory.
---@param bundle_path string
---@param opts? { extension_id?: string, version?: string, surfaces_required?: string[], surfaces_optional?: string[], permissions?: string[], on_ready?: fun(instance_id: string|nil, err: any) }
function M.install(bundle_path, opts)
  opts = opts or {}
  local function go()
    request("extension/load", {
      extensionId = opts.extension_id or "@local/" .. vim.fn.fnamemodify(bundle_path, ":t:r"),
      version = opts.version or "0.0.0",
      bundlePath = bundle_path,
      permissions = opts.permissions or {},
      surfacesRequired = opts.surfaces_required or {},
      surfacesOptional = opts.surfaces_optional or {},
    }, function(result, err)
      if err then
        vim.notify("oxp: load failed: " .. vim.inspect(err), vim.log.levels.ERROR)
        if opts.on_ready then opts.on_ready(nil, err) end
        return
      end
      local inst = result.instanceId
      instances[result.instanceId] = result
      -- Hand permissions + storage root to the capability layer so
      -- subsequent runtime → host RPCs can scope-check and namespace.
      capabilities.register({
        instance_id = inst,
        extension_id = opts.extension_id or "@local/" .. vim.fn.fnamemodify(bundle_path, ":t:r"),
        permissions = opts.permissions or {},
        host_store_path = vim.fn.stdpath("data") .. "/oxp",
      })
      request("extension/activate", { instanceId = inst }, function(_, aerr)
        if aerr then
          vim.notify("oxp: activate failed: " .. vim.inspect(aerr), vim.log.levels.ERROR)
          if opts.on_ready then opts.on_ready(nil, aerr) end
          return
        end
        vim.notify("oxp: activated " .. inst, vim.log.levels.INFO)
        if opts.on_ready then opts.on_ready(inst, nil) end
      end)
    end)
  end

  if not initialized then
    M.start(function(err)
      if err then
        vim.notify("oxp: " .. err, vim.log.levels.ERROR)
        if opts.on_ready then opts.on_ready(nil, err) end
        return
      end
      go()
    end)
  else
    go()
  end
end

---@param instance_id string
---@param command_id string
---@param args any?
---@param cb? fun(result: any|nil, err: any|nil)
function M.command(instance_id, command_id, args, cb)
  cb = cb or function(r, e)
    if e then
      vim.notify("oxp: command err: " .. vim.inspect(e), vim.log.levels.ERROR)
    else
      vim.notify("oxp: " .. command_id .. " → " .. vim.inspect(r), vim.log.levels.INFO)
    end
  end
  request("extension/command", {
    instanceId = instance_id,
    commandId = command_id,
    argsJson = vim.json.encode(args == nil and vim.NIL or args),
  }, cb)
end

---@param instance_id string
function M.uninstall(instance_id)
  request("extension/deactivate", { instanceId = instance_id }, function()
    notify("extension/unload", { instanceId = instance_id })
    instances[instance_id] = nil
    capabilities.unregister(instance_id)
  end)
end

function M.shutdown(cb)
  cb = cb or function() end
  if not initialized then return cb(nil) end
  request("shutdown", nil, function()
    notify("exit", nil)
    -- Close stdin so the runtime's reader loop sees EOF and breaks out of
    -- its select! — `exit` alone leaves the loop blocked on the next read.
    if stdin and not stdin:is_closing() then stdin:close() end
    cb(nil)
  end)
end

function M.status()
  return {
    pid = pid,
    initialized = initialized,
    instances = vim.tbl_keys(instances),
    pending_requests = vim.tbl_count(pending),
  }
end

return M
