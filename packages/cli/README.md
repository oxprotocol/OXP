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

## Icons

Every published extension needs an icon. The OXP host renderers (VS Code,
JetBrains, Neovim) all decode **PNG** — SVG support varies, so PNG is the
cross-host floor. The CLI ships a generator so you don't need ImageMagick:

```sh
oxp icon init                            # rounded chevron square (default)
oxp icon init -t terminal --bg "#0d1117" --fg "#3fb950"
oxp icon from "🚀"                       # emoji icon (via Twemoji)
oxp icon from "OXP" --bg "#7c3aed"       # 1–3 letter monogram
oxp icon convert logo.svg --size 256     # rasterise an existing SVG
oxp icon preview                         # see your icon at every IDE size
```

Each subcommand emits **both** an `icon.svg` (editable source) and an
`icon.png` (what hosts actually load), then prints the `oxp.json` snippet:

```json
{ "icon": "icon.png" }
```

Built-in templates: `chevron`, `terminal`, `branch`, `swatch`, `package`.

### Bring your own icon

Prefer a hand-crafted look? Any of these pair well with `oxp icon convert`:

- [Lucide](https://lucide.dev) — 1,500+ icons, ISC, downloadable as SVG
- [Tabler Icons](https://tabler.io/icons) — 5,800+ icons, MIT
- [Phosphor Icons](https://phosphoricons.com) — 9,000+ icons, MIT
- [icon.kitchen](https://icon.kitchen) — in-browser editor, free export
- ImageMagick: `magick -background none -density 256 logo.svg -resize 256x256 icon.png`
- rsvg-convert: `rsvg-convert -w 256 -h 256 logo.svg -o icon.png`

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
