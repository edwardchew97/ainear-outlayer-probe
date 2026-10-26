# outlayer-probe

Minimal [OutLayer](https://outlayer.fastnear.com) program (WASI Preview 2) for the aiNEAR keeper spike.
Inside the TEE it reads the CLOUD token's `get_supply_info` from NEAR testnet RPC over HTTPS and prints a
small JSON result.

Input: `{"contract": "mw-cloud-1024.testnet", "rpc": "https://rpc.testnet.fastnear.com"}` (both optional).

```bash
cargo build --release --target wasm32-wasip2
```

```bash
echo '{}' | wasmtime run -S http target/wasm32-wasip2/release/outlayer-probe.wasm
```

`run-onchain.mjs` runs it on `outlayer.testnet` with `request_execution`, from a GitHub commit
(`GITHUB=https://github.com/owner/repo@<commit>`) or from a FastFS upload.
