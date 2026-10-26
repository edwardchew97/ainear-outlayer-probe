// Run the probe on OutLayer testnet with request_execution, paid in testnet NEAR. The source is
// either a GitHub commit (OutLayer compiles it) or, without GITHUB, the local WASM uploaded to FastFS.
//
//   node run-onchain.mjs <signer.testnet> [input-json]
//   GITHUB=https://github.com/owner/repo@<commit> node run-onchain.mjs <signer.testnet> [input-json]
//   WASM_URL=https://…/outlayer-probe.wasm node run-onchain.mjs <signer.testnet> [input-json]
//
// The signer's key is read from ~/.near-credentials/testnet/.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { connect, keyStores, transactions } from "near-api-js";

const [signer, input = "{}"] = process.argv.slice(2);
if (!signer) throw new Error("usage: node run-onchain.mjs <signer.testnet> [input-json]");

const OUTLAYER = "outlayer.testnet";
const RPC = "https://rpc.testnet.fastnear.com";

const near = await connect({
  networkId: "testnet",
  nodeUrl: RPC,
  keyStore: new keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), ".near-credentials")),
});
const account = await near.account(signer);

let source;
if (process.env.GITHUB) {
  const [repo, commit] = process.env.GITHUB.split("@");
  source = { GitHub: { repo, commit, build_target: "wasm32-wasip2" } };
} else if (process.env.WASM_URL) {
  // Any HTTPS URL; OutLayer checks the download against the local build's sha256.
  const hash = createHash("sha256").update(readFileSync("target/wasm32-wasip2/release/outlayer-probe.wasm")).digest("hex");
  source = { WasmUrl: { url: process.env.WASM_URL, hash, build_target: "wasm32-wasip2" } };
} else {
  source = await uploadToFastfs();
}
console.log("source", JSON.stringify(source));

// ---- FastFS upload (borsh: enum variant 0 = Simple { relative_path, Some({ mime_type, content }) }) ----
async function uploadToFastfs() {
  const wasm = readFileSync("target/wasm32-wasip2/release/outlayer-probe.wasm");
  const hash = createHash("sha256").update(wasm).digest("hex");
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const str = (s) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
  const relativePath = `${hash}.wasm`;
  const payload = Buffer.concat([Buffer.from([0]), str(relativePath), Buffer.from([1]), str("application/wasm"), u32(wasm.length), wasm]);
  const url = `https://test.fastfs.io/${signer}/${OUTLAYER}/${relativePath}`;

  const already = await fetch(url).then(async (r) => r.ok && createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex") === hash);
  if (!already) {
    console.log(`uploading ${wasm.length} bytes to FastFS (the tx fails on purpose: gas=1)…`);
    try {
      // Gas 1 makes the receipt fail; the FastFS indexer reads the args from the transaction anyway.
      await account.signAndSendTransaction({
        receiverId: OUTLAYER,
        actions: [transactions.functionCall("__fastdata_fastfs", payload, 1n, 0n)],
      });
    } catch (e) {
      console.log(`  expected failure: ${String(e.message ?? e).slice(0, 100)}`);
    }
    const t0 = Date.now();
    for (;;) {
      const r = await fetch(url);
      if (r.ok && createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex") === hash) break;
      if (Date.now() - t0 > 5 * 60_000) throw new Error(`FastFS never served ${url}`);
      await new Promise((res) => setTimeout(res, 10_000));
    }
    console.log(`  indexed after ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  console.log(`wasm ${url}\nsha256 ${hash}`);
  return { WasmUrl: { url, hash, build_target: "wasm32-wasip2" } };
}

// ---- request_execution ----
const resource_limits = { max_instructions: 1_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 };
const cost = await account.viewFunction({
  contractId: OUTLAYER,
  methodName: "estimate_execution_cost",
  args: { resource_limits, input_data_size: input.length },
});
console.log(`cost ${Number(BigInt(cost)) / 1e24} NEAR (testnet)`);

const t0 = Date.now();
const outcome = await account.signAndSendTransaction({
  receiverId: OUTLAYER,
  actions: [
    transactions.functionCall(
      "request_execution",
      {
        source,
        resource_limits,
        input_data: input,
        secrets_ref: null,
        response_format: "Json",
        payer_account_id: null,
        params: null,
      },
      300_000_000_000_000n,
      BigInt(cost),
    ),
  ],
});
console.log(`tx ${outcome.transaction.hash} done after ${Date.now() - t0} ms`);
for (const r of outcome.receipts_outcome) for (const l of r.outcome.logs) console.log(`  log: ${l.slice(0, 400)}`);
const ok = outcome.status.SuccessValue;
console.log("result:", ok !== undefined ? Buffer.from(ok, "base64").toString() : JSON.stringify(outcome.status));
