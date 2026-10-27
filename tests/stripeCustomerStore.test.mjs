import test from "node:test";
import assert from "node:assert/strict";
import { getStripeCustomerId, saveStripeCustomerId } from "../server/stripeCustomerStore.js";

const USER = "b10edb23-a22c-4b0c-993e-a983e04227d2";
function makeAdmin({ stored = null, lookupError = null, upsertError = null } = {}) {
  const saved = [];
  const admin = {
    from(table) {
      assert.equal(table, "wavo_billing_customer_links");
      return {
        select(columns) {
          assert.equal(columns, "stripe_customer_id");
          return {
            eq(column, value) {
              assert.equal(column, "user_id");
              assert.equal(value, USER);
              return {
                async maybeSingle() {
                  return { data: stored ? { stripe_customer_id: stored } : null, error: lookupError };
                },
              };
            },
          };
        },
        async upsert(value, options) {
          assert.equal(options.onConflict, "user_id");
          assert.equal(value.user_id, USER);
          saved.push(value);
          return { error: upsertError };
        },
      };
    },
  };
  return { admin, saved };
}

test("reads a private customer id without writing a public profile", async () => {
  const db = makeAdmin({ stored: "cus_existing" });
  assert.equal(await getStripeCustomerId(db.admin, USER, "cus_legacy"), "cus_existing");
  assert.equal(db.saved.length, 0);
});

test("migrates an existing legacy customer id to the private store", async () => {
  const db = makeAdmin();
  assert.equal(await getStripeCustomerId(db.admin, USER, "cus_legacy"), "cus_legacy");
  assert.equal(db.saved.length, 1);
  assert.equal(db.saved[0].stripe_customer_id, "cus_legacy");
});

test("saves newly created Stripe customers to the private store", async () => {
  const db = makeAdmin();
  assert.equal(await saveStripeCustomerId(db.admin, USER, "cus_new"), "cus_new");
  assert.equal(db.saved.length, 1);
});

test("returns null when no billing customer exists", async () => {
  const db = makeAdmin();
  assert.equal(await getStripeCustomerId(db.admin, USER), null);
  assert.equal(db.saved.length, 0);
});

test("fails closed when private billing lookup is unavailable", async () => {
  const db = makeAdmin({ lookupError: { code: "42P01" } });
  await assert.rejects(getStripeCustomerId(db.admin, USER, "cus_legacy"), /temporarily unavailable/);
  assert.equal(db.saved.length, 0);
});

test("fails closed if migration of legacy id cannot be saved", async () => {
  const db = makeAdmin({ upsertError: { code: "42501" } });
  await assert.rejects(getStripeCustomerId(db.admin, USER, "cus_legacy"), /Could not securely save/);
});

test("rejects malformed customer ids", async () => {
  const db = makeAdmin();
  await assert.rejects(saveStripeCustomerId(db.admin, USER, "not_a_customer"), /Invalid Stripe customer/);
  assert.equal(db.saved.length, 0);
});

test("rejects missing authenticated identities", async () => {
  const db = makeAdmin();
  await assert.rejects(getStripeCustomerId(db.admin, ""), /Billing user identity is missing/);
});
