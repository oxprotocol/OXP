# __DISPLAY_NAME__

A minimal OXP extension scaffolded by `oxp create`.

## Build

```sh
oxp pack
```

Writes `dist/__SLUG__-<version>.oxp` and `dist/__SLUG__-<version>.sig.json`.

## Publish

```sh
oxp login                     # paste an API token from the registry
oxp publish dist/__SLUG__-*.oxp
```
