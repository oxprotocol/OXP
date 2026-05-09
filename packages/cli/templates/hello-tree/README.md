# __DISPLAY_NAME__

A V1 component-tree extension. The UI is a static `ui/tree.json` rendered by
the host through `@oxprotocol/ui/dom`. No HTML, no CSS, no JS — and on Piye-native
hosts, no DOM either.

```sh
oxp dev   # hot-reloads the tree on every save
oxp pack  # produces a signed .tgz bundle
```

Edit `ui/tree.json` to change the UI. The vocabulary is frozen at six nodes:
`box`, `stack`, `text`, `button`, `virtual-list`, `code`. Buttons emit a
`data-oxp-action` attribute that the host bridges to `host.dispatch(action)`
once the worker harness lands.
