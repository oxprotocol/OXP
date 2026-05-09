# @oxprotocol/bundle

Pack, unpack, sign and verify `.oxp` extension bundles per [`spec/v1/bundle.md`](../../spec/v1/bundle.md).

```ts
import { packBundle, unpackBundle, signEd25519, verifyEd25519 } from "@oxprotocol/bundle";

const { oxp, bundleSha256 } = await packBundle("./my-extension");
const sig = signEd25519(bundleSha256, privKeyPem, pubKeyPem);
```
