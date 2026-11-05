import test from "node:test";
import assert from "node:assert/strict";
import { getCheckoutReturnOrigin } from "../server/checkoutReturnOrigin.js";
import { readFileSync } from "node:fs";

test("returns trusted Wavo origin by default", () => {
  assert.equal(getCheckoutReturnOrigin(""), "https://www.wavo.lol");
});
test("supports explicitly configured HTTPS origins", () => {
  assert.equal(getCheckoutReturnOrigin("https://wavo.lol"), "https://wavo.lol");
  assert.equal(getCheckoutReturnOrigin("https://www.wavo.lol/"), "https://www.wavo.lol");
});
test("rejects non-HTTPS checkout return URLs", () => {
  assert.throws(() => getCheckoutReturnOrigin("http://www.wavo.lol"), /clean HTTPS/);
});
test("rejects credential-injection and query/fragment URL values", () => {
  for (const url of [
    "https://bob:password@www.wavo.lol",
    "https://www.wavo.lol/?redirect=https://evil.example",
    "https://www.wavo.lol/#redirect",
    "https://www.wavo.lol/malicious-path",
  ]) {
    assert.throws(() => getCheckoutReturnOrigin(url), /clean HTTPS/);
  }
});
test("checkout no longer trusts request Origin or Host as redirect destination", () => {
  const checkout = readFileSync(new URL("../api/checkout.js", import.meta.url), "utf8");
  assert.match(checkout, /const origin = getCheckoutReturnOrigin\(\)/);
  assert.doesNotMatch(checkout, /req\.headers\.(?:origin|host)/);
});
