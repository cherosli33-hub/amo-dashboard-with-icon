import test from "node:test";
import assert from "node:assert/strict";
import { readAccessProfile } from "../data-dashboard/access.mjs";
const user = { uid:"test-user", getIdToken:async () => "test-token" };
test("access check uses authenticated HTTPS and reads authoritative role", async () => {
  const profile = await readAccessProfile(user, "test-project", { fetchImpl:async (url, options) => {
    assert.equal(url, "https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/users/test-user");
    assert.equal(options.headers.Authorization, "Bearer test-token"); assert.equal(options.cache, "no-store");
    return { ok:true, json:async () => ({ fields:{ role:{ stringValue:"admin" }, active:{ booleanValue:true }, name:{ stringValue:"Test Admin" } } }) };
  } });
  assert.deepEqual(profile, { uid:"test-user", name:"Test Admin", email:"", role:"admin", active:true });
});
test("missing profile cannot grant access", async () => {
  assert.equal(await readAccessProfile(user, "test", { fetchImpl:async () => ({ status:404 }) }), null);
});
test("permission-denied profile does not fall back to email allowlist or stale cache", async () => {
  await assert.rejects(readAccessProfile(user, "test", { fetchImpl:async () => ({ ok:false, status:403 }) }), /tidak dapat dibaca/);
});
test("network read aborts instead of holding gate indefinitely", async () => {
  await assert.rejects(readAccessProfile(user, "test", { timeoutMs:5, fetchImpl:async (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) }), { name:"AbortError" });
});
test("token restoration has a timeout too", async () => {
  let fetched = false;
  await assert.rejects(readAccessProfile({ uid:"x", getIdToken:() => new Promise(() => {}) }, "test", { timeoutMs:5, fetchImpl:async () => { fetched = true; } }), /terlalu lama/);
  assert.equal(fetched, false);
});
