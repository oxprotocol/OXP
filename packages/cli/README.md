# @oxprotocol/cli

The official command-line tool for the [Open eXtensions Protocol](https://oxp.dev).

## Install

Pick whichever package manager you already have. The CLI ships as a single
npm package — there is **no separate installer to download**.

### One-shot (no install)

```sh
npx @oxprotocol/cli@latest create my-ext
pnpm dlx @oxprotocol/cli create my-ext
yarn dlx @oxprotocol/cli create my-ext
```

### Persistent install (recommended)

```sh
npm  i -g @oxprotocol/cli       # then: oxp <command>
pnpm add -g @oxprotocol/cli
yarn global add @oxprotocol/cli
```

After install, `oxp --help` lists every subcommand.

### `npm create` shortcut

For scaffolding only, the dedicated `create-oxp` wrapper plays nicely with
the `npm create` / `pnpm create` convention:

```sh
npm  create oxp@latest my-ext
pnpm create oxp my-ext
yarn create oxp my-ext
```

## First run

```sh
oxp login            # email + password, in the terminal (Expo-style)
oxp login --browser  # OR authorise via the web (OAuth device flow)

oxp create my-ext    # scaffold (pick a template with -t)
cd my-ext
oxp dev              # watch + hot-reload against a local host
oxp pack             # build a deterministic, signed .oxp bundle
oxp publish          # upload to the registry
```

Tokens are stored at `~/.oxp/credentials` (mode 0600). The CLI sends them
as `Authorization: Bearer <raw>`. Rotate any time with `oxp token rotate`.

## Environment

| Var            | Default                  | Purpose                       |
| -------------- | ------------------------ | ----------------------------- |
| `OXP_REGISTRY` | `https://oxp.sh`         | Registry base URL             |
| `OXP_HOME`    | `~/.oxp`                 | Config + credentials directory |

## Programmatic use

Subcommand functions are also exported for wrapper packages:

```ts
import { create, pack, publish } from "@oxprotocol/cli";
const code = await create(["my-ext", "-t", "hello-rust"]);
```

## License

MIT
