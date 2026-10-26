// Minimal OutLayer probe for the aiNEAR keeper: inside the TEE, read the CLOUD contract's supply
// over HTTPS (NEAR RPC view call) and return a small JSON result (on-chain output must be ≤900 bytes).
//
// Input:  {"contract": "mw-cloud-1024.testnet", "rpc": "https://rpc.testnet.fastnear.com"}
// Output: {"ok": true, "contract": ..., "supply": {...}, "block_height": ...}

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::time::Duration;
use wasi_http_client::Client;

#[derive(Deserialize)]
struct Input {
    #[serde(default = "default_contract")]
    contract: String,
    #[serde(default = "default_rpc")]
    rpc: String,
}

fn default_contract() -> String {
    "mw-cloud-1024.testnet".into()
}

fn default_rpc() -> String {
    "https://rpc.testnet.fastnear.com".into()
}

fn view(rpc: &str, contract: &str, method: &str) -> Result<(Value, u64), String> {
    let body = json!({
        "jsonrpc": "2.0", "id": "probe", "method": "query",
        "params": { "request_type": "call_function", "finality": "final", "account_id": contract,
                    "method_name": method, "args_base64": "e30=" }
    })
    .to_string();
    let res = Client::new()
        .post(rpc)
        .header("Content-Type", "application/json")
        .connect_timeout(Duration::from_secs(10))
        .body(body.as_bytes())
        .send()
        .map_err(|e| format!("rpc request: {e:?}"))?;
    let bytes = res.body().map_err(|e| format!("rpc body: {e:?}"))?;
    let v: Value = serde_json::from_slice(&bytes).map_err(|e| format!("rpc json: {e}"))?;
    let r = v.get("result").ok_or_else(|| format!("rpc error: {}", v["error"]))?;
    let raw: Vec<u8> = serde_json::from_value(r["result"].clone()).map_err(|e| format!("result bytes: {e}"))?;
    let out = serde_json::from_slice(&raw).map_err(|e| format!("result json: {e}"))?;
    Ok((out, r["block_height"].as_u64().unwrap_or(0)))
}

fn main() {
    let mut s = String::new();
    let _ = io::stdin().read_to_string(&mut s);
    let out = match serde_json::from_str::<Input>(if s.trim().is_empty() { "{}" } else { &s }) {
        Err(e) => json!({ "ok": false, "error": format!("bad input: {e}") }),
        Ok(i) => match view(&i.rpc, &i.contract, "get_supply_info") {
            Ok((supply, height)) => json!({ "ok": true, "contract": i.contract, "supply": supply, "block_height": height }),
            Err(e) => json!({ "ok": false, "error": e }),
        },
    };
    print!("{out}");
    let _ = io::stdout().flush();
}
