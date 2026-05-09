# Squatter stubs

These are minimal placeholder packages we publish to npm to **prevent
typo-squatting and impersonation** of the OXP CLI. Each one only contains
a `README` and an `index.js` that prints a "you probably meant `@oxprotocol/cli`"
message and exits.

These are **not** part of the workspace build. They are published manually
once with `npm publish --access public` and then forgotten.

Names reserved here:

- `oxp-cli`
- `oxpcli`
- `oxp-sdk`
- `oxp-tools`
- `oxp-host`
- `oxp.js`
- `0xp`
- `oxpp`

To publish a new one: `cd packages/_squatters/<name> && npm publish --access public`.
