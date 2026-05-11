# Review Ext

A minimal OXP extension scaffolded by `oxp create`.

## Build

```sh
oxp pack
```

Writes `dist/review-ext-<version>.oxp` and `dist/review-ext-<version>.sig.json`.

## Publish

```sh
oxp login                     # paste an API token from the registry
oxp publish dist/review-ext-*.oxp
```
