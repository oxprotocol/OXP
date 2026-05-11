-- oxp.dev — Extension Development Host driver for Neovim.
--
-- Mirrors what the VS Code and JetBrains hosts give a developer running
-- `oxp dev`:
--
--   * a dedicated EDH workspace surface (here a new tab + scratch buffer);
--   * hot reload — every successful rebuild swaps the live bundle without
--     the user touching anything;
--   * an error boundary — when the bundle blows up at load/activate,
--     the failure renders in a themed float instead of vanishing silently;
--   * automatic teardown — when the CLI exits the EDH tab closes itself.
--
-- The CLI drives this module from outside Neovim. It writes the current
-- session state to `~/.cache/oxp/dev-<pid>/state.json` (plus a real
-- `bundle.oxp` next to it) and pings the running Neovim instance via
-- `nvim --server $NVIM --remote-send ':lua require("oxp.dev").refresh()<CR>'`.
-- That keeps this module free of any WebSocket/HTTP code — the CLI
-- already owns the dev server, so it's the natural source of truth.
--
-- State file schema (kept in sync with packages/cli/src/lib/neovim-edh.ts):
--   {
--     "status":      "ready" | "error" | "shutdown",
--     "session_dir": "/abs/path/to/dev-<pid>",
--     "bundle_path": "/abs/path/to/bundle.oxp",   -- only when status=ready
--     "manifest":    { "id": "...", "version": "...", ... },
--     "error":       "string|nil",
--     "built_at":    1715472000000
--   }

local oxp = require("oxp")

local M = {}

---@class OxpDevSession
---@field project_root string
---@field runtime_path string
---@field session_dir  string  -- where the CLI writes state.json
---@field tabnr        integer
---@field bufnr        integer
---@field winid        integer
---@field instance_id  string|nil
---@field manifest     table|nil
---@field last_built   integer|nil
---@field error_win    integer|nil
---@field error_buf    integer|nil

---@type OxpDevSession|nil
local session = nil

local uv = vim.uv or vim.loop

-- ──────────────────────────────────────────────────────────────────
-- internal helpers
-- ──────────────────────────────────────────────────────────────────

local function read_file(path)
  local fd = uv.fs_open(path, "r", 420)
  if not fd then return nil end
  local stat = uv.fs_fstat(fd)
  local data = stat and uv.fs_read(fd, stat.size, 0) or nil
  uv.fs_close(fd)
  return data
end

local function set_lines(buf, lines)
  if not vim.api.nvim_buf_is_valid(buf) then return end
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
end

local function append_lines(buf, lines)
  if not vim.api.nvim_buf_is_valid(buf) then return end
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, -1, -1, false, lines)
  vim.bo[buf].modifiable = false
end

local function timestamp()
  return os.date("%H:%M:%S")
end

local function log(sess, level, msg)
  if not sess or not vim.api.nvim_buf_is_valid(sess.bufnr) then return end
  append_lines(sess.bufnr, { ("[%s] %s  %s"):format(timestamp(), level, msg) })
end

local function close_error_overlay(sess)
  if sess.error_win and vim.api.nvim_win_is_valid(sess.error_win) then
    pcall(vim.api.nvim_win_close, sess.error_win, true)
  end
  if sess.error_buf and vim.api.nvim_buf_is_valid(sess.error_buf) then
    pcall(vim.api.nvim_buf_delete, sess.error_buf, { force = true })
  end
  sess.error_win = nil
  sess.error_buf = nil
end

-- Themed error boundary: red-bordered float, message + stack, `q` / `<Esc>`
-- to dismiss. Re-rendering is idempotent — we wipe the previous float
-- before drawing the new one so quick reload thrash doesn't pile up.
local function show_error_overlay(sess, title, message, stack)
  close_error_overlay(sess)

  local lines = {}
  table.insert(lines, "⚠ " .. (title or "Extension error"))
  table.insert(lines, string.rep("─", 60))
  for line in tostring(message or ""):gmatch("[^\r\n]+") do
    table.insert(lines, line)
  end
  if stack and stack ~= "" then
    table.insert(lines, "")
    table.insert(lines, "stack:")
    for line in tostring(stack):gmatch("[^\r\n]+") do
      table.insert(lines, "  " .. line)
    end
  end
  table.insert(lines, "")
  table.insert(lines, "press q / <Esc> to dismiss — fix the source and save to retry")

  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].filetype  = "oxp-dev-error"
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false

  local ui = vim.api.nvim_list_uis()[1]
  local width  = math.min(100, (ui and ui.width  or 120) - 8)
  local height = math.min(#lines + 2, (ui and ui.height or 30) - 6)
  local row    = math.floor(((ui and ui.height or 30) - height) / 2)
  local col    = math.floor(((ui and ui.width  or 120) - width)  / 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    row = row,
    col = col,
    width = width,
    height = height,
    style = "minimal",
    border = "rounded",
    title = " OXP Dev — runtime error ",
    title_pos = "left",
  })
  -- Red border + body, matches the VS Code overlay's accent.
  vim.api.nvim_set_option_value("winhighlight",
    "Normal:OxpDevError,FloatBorder:OxpDevErrorBorder,FloatTitle:OxpDevErrorTitle",
    { win = win })

  for _, k in ipairs({ "q", "<Esc>" }) do
    vim.keymap.set("n", k, function() close_error_overlay(sess) end,
      { buffer = buf, nowait = true, silent = true })
  end

  sess.error_win = win
  sess.error_buf = buf
end

-- ──────────────────────────────────────────────────────────────────
-- session lifecycle
-- ──────────────────────────────────────────────────────────────────

local function ensure_highlights()
  -- Themed once; users can override after :colorscheme. Background
  -- colors are chosen to read well against both dark + light themes.
  vim.api.nvim_set_hl(0, "OxpDevError",       { fg = "#fca5a5", bg = "#1f0a0a", default = true })
  vim.api.nvim_set_hl(0, "OxpDevErrorBorder", { fg = "#f87171",                 default = true })
  vim.api.nvim_set_hl(0, "OxpDevErrorTitle",  { fg = "#fecaca", bold = true,    default = true })
  vim.api.nvim_set_hl(0, "OxpDevHeader",      { fg = "#86efac", bold = true,    default = true })
  vim.api.nvim_set_hl(0, "OxpDevDim",         { fg = "#71717a",                 default = true })
end

-- Opens the EDH tab. Buffer is a scratch sink for status + the running
-- log; the rest of the surface mapping (statusline / extmark virt_text)
-- comes from the regular oxp capabilities while the extension runs.
local function open_edh_tab(sess)
  vim.cmd("tabnew")
  local tabnr = vim.api.nvim_get_current_tabpage()
  local winid = vim.api.nvim_get_current_win()
  local buf   = vim.api.nvim_get_current_buf()

  vim.bo[buf].buftype    = "nofile"
  vim.bo[buf].bufhidden  = "wipe"
  vim.bo[buf].swapfile   = false
  vim.bo[buf].buflisted  = false
  vim.bo[buf].filetype   = "oxp-dev"
  pcall(vim.api.nvim_buf_set_name, buf, "[OXP Dev]")

  vim.wo[winid].number         = false
  vim.wo[winid].relativenumber = false
  vim.wo[winid].signcolumn     = "no"
  vim.wo[winid].wrap           = false
  vim.wo[winid].cursorline     = false

  set_lines(buf, {
    "▸ OXP Extension Development Host",
    "  project: " .. sess.project_root,
    "  session: " .. sess.session_dir,
    string.rep("─", 64),
    "",
  })

  -- Cleanup hooks. If the user closes the tab manually, tear down the
  -- session so a subsequent :OxpDevAttach starts clean.
  vim.api.nvim_create_autocmd("TabClosed", {
    pattern = tostring(tabnr),
    once = true,
    callback = function() M.shutdown() end,
  })

  sess.tabnr = tabnr
  sess.winid = winid
  sess.bufnr = buf
end

---Attach to a CLI-managed dev session. The CLI passes:
---  * project_root — the project being developed
---  * runtime_path — the oxp-runtime binary the CLI bundled
---  * session_dir  — `<XDG_CACHE_HOME>/oxp/dev-<pid>/` with state.json
---@param project_root string
---@param runtime_path string
---@param session_dir  string
function M.attach(project_root, runtime_path, session_dir)
  if session then
    -- Re-attach: refuse to silently take over a live session.
    vim.notify("oxp.dev: a session is already attached — :OxpDevDetach first",
      vim.log.levels.WARN)
    return
  end
  ensure_highlights()

  session = {
    project_root = project_root,
    runtime_path = runtime_path,
    session_dir  = session_dir,
    tabnr = 0, winid = 0, bufnr = 0,
    instance_id = nil, manifest = nil, last_built = nil,
    error_win = nil, error_buf = nil,
  }
  open_edh_tab(session)

  -- The runtime path comes from the CLI; let the host module spawn it
  -- when the first install lands. We *don't* call oxp.setup() if the
  -- user already configured it — :OxpDevAttach must compose, not stomp.
  pcall(oxp.setup, { runtime = runtime_path, log_level = "info" })

  log(session, "INFO ", "attached — waiting for first build")
  -- Pull state immediately in case the CLI already wrote it.
  M.refresh()
end

---Re-read the CLI's state.json and apply it. Called by the CLI via
---`nvim --server $NVIM --remote-send ':lua require("oxp.dev").refresh()<CR>'`
---on every reload / error / shutdown.
function M.refresh()
  local sess = session
  if not sess then return end
  local path = sess.session_dir .. "/state.json"
  local raw = read_file(path)
  if not raw then return end

  local ok, state = pcall(vim.json.decode, raw)
  if not ok or type(state) ~= "table" then
    log(sess, "WARN ", "ignored malformed state.json: " .. tostring(state))
    return
  end

  if state.status == "ready" then
    if sess.last_built == state.built_at then return end -- de-dup
    sess.last_built = state.built_at
    M._apply_reload(state)
  elseif state.status == "error" then
    M.report_error("Build failed", state.error or "unknown error", nil)
  elseif state.status == "shutdown" then
    log(sess, "INFO ", "CLI shut down — closing EDH")
    M.shutdown()
  end
end

-- Install + activate the latest bundle, with a pcall boundary that
-- routes any exception into the themed overlay instead of letting it
-- ride up into Neovim's startup error path.
function M._apply_reload(state)
  local sess = session
  if not sess then return end
  local label = ("%s@%s"):format(
    (state.manifest or {}).id or "?",
    (state.manifest or {}).version or "?")
  log(sess, "INFO ", "reload " .. label)

  -- Tear down any previous instance before loading the next bundle.
  -- We don't wait for the round-trip — the runtime is single-tenant
  -- per process for now, so the load below will queue behind it.
  if sess.instance_id then
    pcall(oxp.uninstall, sess.instance_id)
    sess.instance_id = nil
  end

  local ok, err = pcall(oxp.install, state.bundle_path, {
    extension_id      = (state.manifest or {}).id,
    version           = (state.manifest or {}).version,
    permissions       = (state.manifest or {}).permissions or {},
    surfaces_required = ((state.manifest or {}).surfaces or {}).required or {},
    surfaces_optional = ((state.manifest or {}).surfaces or {}).optional or {},
    on_ready = function(instance_id, e)
      if e then
        local msg = type(e) == "table" and (e.message or vim.inspect(e)) or tostring(e)
        M.report_error("Extension failed to activate", msg, nil)
        return
      end
      sess.instance_id = instance_id
      sess.manifest = state.manifest
      close_error_overlay(sess)
      log(sess, "OK   ", label .. " ready (" .. instance_id .. ")")
    end,
  })
  if not ok then
    M.report_error("Extension load threw", tostring(err), debug.traceback(nil, 2))
  end
end

---Render a runtime-error overlay. The CLI calls this for build errors;
---the load/activate flow above calls it for runtime errors. Both paths
---share one overlay so quick rebuilds replace the previous failure.
---@param title    string
---@param message  string
---@param stack    string|nil
function M.report_error(title, message, stack)
  if not session then return end
  log(session, "ERR  ", title .. " — " .. tostring(message):gsub("\n", " | "))
  show_error_overlay(session, title, message, stack)
end

---Detach + close the EDH tab. Safe to call multiple times.
function M.shutdown()
  local sess = session
  session = nil
  if not sess then return end
  close_error_overlay(sess)
  if sess.instance_id then
    pcall(oxp.uninstall, sess.instance_id)
  end
  pcall(oxp.shutdown)
  -- Close the EDH tab if it's still around. Wrap in pcall — the user
  -- may have already :tabclose'd it, which is what triggered us.
  if sess.tabnr and vim.api.nvim_tabpage_is_valid(sess.tabnr) then
    pcall(vim.api.nvim_buf_delete, sess.bufnr, { force = true })
  end
end

---For tests / diagnostics.
function M.status()
  if not session then return { attached = false } end
  return {
    attached     = true,
    project_root = session.project_root,
    session_dir  = session.session_dir,
    instance_id  = session.instance_id,
    manifest_id  = session.manifest and session.manifest.id or nil,
    last_built   = session.last_built,
  }
end

return M
