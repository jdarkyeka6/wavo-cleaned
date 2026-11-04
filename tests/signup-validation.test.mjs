import test from "node:test";
import assert from "node:assert/strict";
import { ageFromBirthDate, validateSignup } from "../src/lib/signupValidation.js";

const today = new Date("2026-11-04T12:00:00Z");
const good = {
  firstName: "Alex", lastName: "", birthday: "2013-11-04",
  username: "alex_123", email: "alex@example.org",
  password: "correct-horse", confirmPassword: "correct-horse", agreed: true,
};

test("13th birthday is eligible; day before is not", () => {
  assert.equal(ageFromBirthDate("2013-11-04", today), 13);
  assert.equal(ageFromBirthDate("2013-11-05", today), 12);
  assert.equal(validateSignup(good, today).valid, true);
  assert.match(validateSignup({ ...good, birthday: "2013-11-05" }, today).errors.birthday, /under-13/);
});

test("invalid and impossible dates do not pass", () => {
  assert.equal(ageFromBirthDate("2012-02-30", today), null);
  assert.equal(ageFromBirthDate("2027-01-01", today), -1);
  assert.ok(validateSignup({ ...good, birthday: "2012-02-30" }, today).errors.birthday);
});

test("username and email rules protect the older internal email namespace", () => {
  assert.ok(validateSignup({ ...good, username: "a!" }, today).errors.username);
  assert.ok(validateSignup({ ...good, email: "alex@wavo.app" }, today).errors.email);
});

test("passwords, names and terms must be valid", () => {
  const result = validateSignup({ ...good, firstName: "", password: "short", confirmPassword: "other", agreed: false }, today);
  assert.equal(result.valid, false);
  for (const key of ["firstName", "password", "confirmPassword", "agreed"]) assert.ok(result.errors[key]);
});
