-- Headless smoke test for oxp.nvim. Runs the same scenario as
-- runtime/scripts/smoke_hello_rust.py but driven from Neovim.
--
-- Invoke from repo root (oxp/):
--
--   nvim --headless --clean \
--     -u hosts/neovim/scripts/smoke_init.lua \
--     +qa
--
-- Expected stdout/stderr ends with "SMOKE OK" on success.

local function repo_root()
  local this = debug.getinfo(1, "S").source:sub(2)
  -- this = .../oxp/hosts/neovim/scripts/smoke_init.lua
  return vim.fn.fnamemodify(this, ":h:h:h:h")
end

local root = repo_root()
vim.opt.runtimepath:prepend(root .. "/hosts/neovim")

local runtime  = root .. "/runtime/target/debug/oxp-runtime"
local wasm     = root .. "/examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm"

assert(vim.fn.filereadable(runtime) == 1, "oxp-runtime not built: " .. runtime)
assert(vim.fn.filereadable(wasm) == 1, "hello_rust.wasm not built: " .. wasm)

local oxp = require("oxp")
oxp.setup({ runtime = runtime, log_level = "info" })

local done = false
local exit_code = 1

oxp.install(wasm, {
  extension_id = "@aldgar/hello",
  version = "0.1.0",
  surfaces_required = { "ui.statusBar" },
  on_ready = function(inst, err)
    if err then
      io.stderr:write("install failed: " .. vim.inspect(err) .. "\n")
      done = true
      return
    end
    oxp.command(inst, "hello.greet", { name = "neovim" }, function(result, cerr)
      if cerr then
        io.stderr:write("command failed: " .. vim.inspect(cerr) .. "\n")
      else
        io.stdout:write("command result: " .. vim.inspect(result) .. "\n")
        exit_code = 0
      end
      oxp.uninstall(inst)
      vim.defer_fn(function()
        oxp.shutdown(function()
          io.stdout:write(exit_code == 0 and "SMOKE OK\n" or "SMOKE FAIL\n")
          done = true
        end)
      end, 100)
    end)
  end,
})

-- Drive the libuv event loop until our async chain completes.
local deadline = vim.uv.now() + 10000
while not done and vim.uv.now() < deadline do
  vim.wait(100, function() return done end)
end

if not done then
  io.stderr:write("SMOKE TIMEOUT\n")
  os.exit(2)
end
os.exit(exit_code)
