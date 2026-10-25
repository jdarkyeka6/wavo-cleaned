// No external dependencies. Run with: node scripts/check-profile-privacy.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const modules = [
  'src/wavoData.js',
  'src/PremiumProEnhancement.jsx',
  'src/PremiumCosmeticsEnhancement.jsx',
  'src/Admin.jsx',
];
for (const path of modules) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /\.from\s*\(\s*['"]profiles['"]\s*\)\s*\.select\s*\(\s*['"]\*['"]\s*\)/,
    path + ' still reads all columns from profiles'
  );
}
const data = read('src/wavoData.js');
assert.match(data, /rpc\(["']wavo_get_my_profile_v1["']\)/);
assert.match(data, /from\(["']wavo_public_profiles_v1["']\)/);
const admin = read('src/Admin.jsx');
assert.match(admin, /rpc\(["']wavo_get_admin_profiles_v1["']\)/);
const sql = read('security/sql/wavo_safe_profile_read_api_v1.sql');
assert.match(sql, /security_invoker\s*=\s*true/i);
assert.match(sql, /where\s+p\.id\s*=\s*caller/i);
assert.match(sql, /id\s*=\s*caller\s+and\s+is_admin\s+is\s+true/i);
assert.match(sql, /revoke all on function public\.wavo_get_my_profile_v1\(\) from public, anon, authenticated;/i);
const directory = sql.split('create or replace view public.wavo_public_profiles_v1')[1] || '';
for (const field of ['stripe_customer_id', 'birthday', 'email', 'first_name', 'last_name', 'location_default']) {
  assert.doesNotMatch(directory, new RegExp('\\b' + field + '\\b'), 'Directory exposes ' + field);
}
const cutover = read('security/DO_NOT_APPLY_yet_profile_column_privacy_cutover.sql');
assert.match(cutover, /DO NOT put in supabase\/migrations/i);
assert.match(cutover, /revoke select on table public\.profiles from public, anon, authenticated;/i);
console.log('PASS: no wild-card profile reads, scoped RPCs, safe view and staged column-permission gate.');
