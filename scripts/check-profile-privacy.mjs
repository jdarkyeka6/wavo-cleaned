// No external dependencies. Run with: node scripts/check-profile-privacy.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// All browser-facing directory projections must use the safe profile view.
const publicFields = new Set([
  'id', 'username', 'avatar_url', 'status', 'bio', 'created_at',
  'equipped_theme', 'equipped_badge', 'equipped_name_style', 'show_online',
  'last_active', 'is_premium', 'tier',
]);
const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
const files = [];
function visit(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) visit(full);
    else if (item.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(item.name)) files.push(full);
  }
}
visit(srcRoot);
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /\.from\s*\(\s*['"]profiles['"]\s*\)\s*\.select\s*\(\s*['"]\*['"]\s*\)/,
    file + ' reads the entire public.profiles row'
  );
  const selections = /\.from\s*\(\s*(['"])profiles\1\s*\)\s*\.select\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
  for (const match of source.matchAll(selections)) {
    const columns = match[3].split(',').map((column) => column.trim());
    if (columns.length && columns.every((column) => publicFields.has(column))) {
      assert.fail(file + ' queries public-only profile columns from profiles, not the safe view: ' + match[3]);
    }
  }
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
