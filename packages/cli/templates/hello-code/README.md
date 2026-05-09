# __DISPLAY_NAME__

OXP code extension scaffolded from the `hello-code` template.

## Develop

```sh
pnpm install
pnpm dev          # start the dev loop (watch + hot-reload)
```

## Publish

```sh
pnpm pack         # build → dist/__SLUG__-0.0.1.oxp
oxp publish       # upload to the registry
```

## Capabilities

Declare what your extension needs in `oxp.json` → `permissions`:

- `read-clipboard`
- `write-clipboard`
- `storage:local`
- `network:<domain>` (e.g. `network:api.example.com`, or `network:*`)

Use them via the `host` API:

```ts
import { defineExtension, clipboard, net } from "@oxprotocol/sdk";

export default defineExtension({
  async activate(host) {
    const cb = clipboard(host);
    await cb.write("hello");
  },
});
```
