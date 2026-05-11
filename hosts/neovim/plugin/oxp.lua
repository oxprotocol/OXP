-- Register OXP user commands. Loaded automatically by Neovim from
-- `plugin/oxp.lua` once the plugin is on `runtimepath`.
--
-- Most users won't type these themselves — the `oxp` CLI drives them
-- via `nvim --server $NVIM --remote-send`. The commands are exposed so
-- power users can :OxpDevAttach manually for debugging, and so the CLI
-- has a stable surface that doesn't depend on internal API names.

if vim.g.loaded_oxp == 1 then return end
vim.g.loaded_oxp = 1

vim.api.nvim_create_user_command("OxpDevAttach", function(opts)
  local args = opts.fargs
  if #args < 3 then
    vim.notify(
      ":OxpDevAttach requires <project_root> <runtime_path> <session_dir>",
      vim.log.levels.ERROR)
    return
  end
  require("oxp.dev").attach(args[1], args[2], args[3])
end, {
  nargs = "+",
  complete = "file",
  desc = "Attach this Neovim as an OXP Extension Development Host",
})

vim.api.nvim_create_user_command("OxpDevRefresh", function()
  require("oxp.dev").refresh()
end, { desc = "Re-read the CLI's state.json and apply" })

vim.api.nvim_create_user_command("OxpDevDetach", function()
  require("oxp.dev").shutdown()
end, { desc = "Close the OXP Extension Development Host" })

vim.api.nvim_create_user_command("OxpDevStatus", function()
  print(vim.inspect(require("oxp.dev").status()))
end, { desc = "Print the current OXP dev session status" })
