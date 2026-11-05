import test from "node:test";
import assert from "node:assert/strict";
import { ageFromBirthDate, validateSignup } from "../src/lib/signupValidation.js";

const today = new Date("2026-11-04T12:00:00Z");
const good = {
  firstName: "Alex", lastName: "", birthday: "2013-11-04",
  username: "alex_123", email: "alex@example.org",
  password: "correct-horse", confirmPassword: "correct-horse", agreed: true,
};

test("ages 12+ have normal signup, under-12s see guardian review", () => {
  assert.equal(ageFromBirthDate("2014-11-04", today), 12);
  assert.equal(ageFromBirthDate("2014-11-05", today), 11);
  assert.equal(validateSignup({ ...good, birthday: "2014-11-04" }, today).valid, true);
  const younger = { ...good, birthday: "2014-11-05" };
  assert.match(validateSignup(younger, today).errors.guardianApproved, /parent or guardian/);
  assert.equal(validateSignup({ ...younger, guardianApproved: true }, today).valid, true);
  assert.equal(validateSignup(good, today).valid, true);
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


test("explicit +TEST_ signup convention validates without affecting normal usernames", () => {
  assert.equal(validateSignup({ ...good, username: "+TEST_Jasper" }, today).valid, true);
  assert.equal(validateSignup({ ...good, username: "+TEST_ab" }, today).valid, false);
  assert.equal(validateSignup({ ...good, username: "+TEST_" }, today).valid, false);
  assert.equal(validateSignup({ ...good, username: "alex+test" }, today).valid, false);
});

test("approval step appears only for ages 8-11", () => {
  for (const birthday of ["2018-11-04", "2015-11-04"]) {
    const child = { ...good, birthday };
    assert.match(validateSignup(child, today).errors.guardianApproved, /parent or guardian/);
    assert.equal(validateSignup({ ...child, guardianApproved: true }, today).valid, true);
  }
  assert.equal(validateSignup({ ...good, birthday: "2014-11-04" }, today).valid, true);
  assert.match(validateSignup({ ...good, birthday: "2019-11-05", guardianApproved: true }, today).errors.birthday, /age 8/);
});
