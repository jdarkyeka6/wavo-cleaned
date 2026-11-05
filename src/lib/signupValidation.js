// Keep age and form checks independent of the view for deterministic testing.
export function ageFromBirthDate(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || month < 1 || month > 12) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  const currentYear = today.getUTCFullYear();
  let age = currentYear - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age--;
  return age;
}

export function validateSignup(fields, today = new Date()) {
  const errors = {};
  const firstName = String(fields.firstName || "").trim();
  const lastName = String(fields.lastName || "").trim();
  const username = String(fields.username || "").trim().toLowerCase();
  const email = String(fields.email || "").trim().toLowerCase();
  const password = String(fields.password || "");
  const age = ageFromBirthDate(fields.birthday, today);

  if (firstName.length < 1 || firstName.length > 50) errors.firstName = "Enter a first name (up to 50 characters).";
  if (lastName.length > 50) errors.lastName = "Last name must be 50 characters or fewer.";
  const normalName = /^[a-z0-9_]{3,24}$/.test(username);
  const testName = /^\+test_[a-z0-9_]{3,24}$/.test(username);
  if (!normalName && !testName) errors.username = "Use 3–24 letters, numbers or underscores, or +TEST_name for test accounts.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@wavo.app")) errors.email = "Enter a real email address.";
  if (age === null || age > 120 || age < 0) errors.birthday = "Enter a valid date of birth.";
  else if (age < 8) errors.birthday = "Wavo registration starts at age 8.";
  else if (age < 12 && fields.guardianApproved !== true) {
    errors.guardianApproved = "Please show this to your parent or guardian and have them approve before continuing.";
  }
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  if (fields.confirmPassword !== password) errors.confirmPassword = "Passwords don't match.";
  if (!fields.agreed) errors.agreed = "Accept the terms and privacy policy to continue.";

  return { age, errors, valid: Object.keys(errors).length === 0 };
}
