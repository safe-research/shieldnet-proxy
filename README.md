## Shieldnet Proxy

### Development setup

- Install dependencies
```sh
npm install
```

### Cloudflare Proxy Deployment

To run the minimal cosigner it is require to set `PRIVATE_KEY` and `RPC_URL` secrets. This can be done via the dashboard or wrangler cli:

```sh
echo "0xsome private key" | npm exec -- wrangler secret put PRIVATE_KEY
echo "https://some rpc url" | npm exec -- wrangler secret put RPC_URL
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

Once everything is setup the service can be deployed:

```sh
npm run deploy
```

You can test your service by triggering a request against it:

```sh
curl https://your-url.sample/propose \
    -H "Accept: application/json" \
    -H "content-type: application/json" \
    -d '{"type":"PENDING_MULTISIG_TRANSACTION","chainId":"1","address":"0x1280C3d641ad0517918e0E4C41F4AD25f6b39144","safeTxHash":"0x20e178f2ce590c235d30a6e99a78e799053f36bafe2d2022a642be03cb89058c"}'
```