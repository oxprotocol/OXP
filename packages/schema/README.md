# @oxprotocol/schema

JSON Schema (`manifest.schema.json`) for the OXP manifest, plus an Ajv-based validator.

```ts
import { validateManifest, manifestSchema } from "@oxprotocol/schema";

const r = validateManifest(JSON.parse(json));
if (!r.ok) console.error(r.message);
```
