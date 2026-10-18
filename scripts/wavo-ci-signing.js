// Save a reusable signing identity as AES-256-GCM encrypted data.
// The wrapping key is independently derived from the existing ASC private key.
// Neither the .p12 nor its password is committed in plaintext.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const mode = process.argv[2]
const keychain = process.argv[3]
const keychainPassword = process.argv[4]
if (!['restore', 'save'].includes(mode) || !keychain || !keychainPassword) {
  console.error('Usage: node scripts/wavo-ci-signing.js <restore|save> <keychain> <keychain-password>')
  process.exit(2)
}

const file = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), '.github', 'signing', 'wavo-distribution.enc.json')
const raw = (process.env.ASC_KEY_CONTENT || '').trim()
const pem = raw.includes('BEGIN PRIVATE KEY') ? raw : Buffer.from(raw, 'base64').toString('utf8')
if (!pem.includes('BEGIN PRIVATE KEY')) throw Error('Missing ASC signing API key for encryption')
const aad = Buffer.from('wavo-apple-distribution-v1')
const tempDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'wavo-signing-'))
const p12Path = path.join(tempDir, 'identity.p12')

const aesKey = (salt) => Buffer.from(hkdfSync('sha256', Buffer.from(pem), salt, aad, 32))
const encrypt = (buffer) => {
  const salt = randomBytes(24)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', aesKey(salt), iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()])
  return JSON.stringify({
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }, null, 2) + '\n'
}
const decrypt = (serialized) => {
  const obj = JSON.parse(serialized)
  if (obj.version !== 1) throw Error('Unsupported signing archive version')
  const decipher = createDecipheriv('aes-256-gcm', aesKey(Buffer.from(obj.salt, 'base64')), Buffer.from(obj.iv, 'base64'))
  decipher.setAAD(aad)
  decipher.setAuthTag(Buffer.from(obj.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(obj.ciphertext, 'base64')), decipher.final()])
}

async function commitEncrypted(data) {
  const token = process.env.GH_SIGNING_WRITE_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const branch = process.env.GITHUB_REF_NAME
  if (!token || !repo || !branch) throw Error('Missing GitHub write token or repository metadata for preserving CI signing')
  const url = 'https://api.github.com/repos/' + repo + '/contents/.github/signing/wavo-distribution.enc.json'
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch,
      message: 'Store encrypted reusable Wavo iOS signing identity',
      content: Buffer.from(data).toString('base64'),
    }),
  })
  if (!response.ok) throw Error('Unable to securely preserve the new signing identity: GitHub HTTP ' + response.status + ' ' + (await response.text()).slice(0, 500))
}

try {
  if (mode === 'restore') {
    if (!fs.existsSync(file)) {
      console.log('No reusable signing identity stored yet. Fastlane will generate a new one.')
      process.exit(0)
    }
    const payload = JSON.parse(decrypt(fs.readFileSync(file, 'utf8')).toString('utf8'))
    fs.writeFileSync(p12Path, Buffer.from(payload.p12, 'base64'), { mode: 0o600 })
    // Never log the password or the identity itself.
    execFileSync('security', ['import', p12Path, '-k', keychain, '-P', payload.password, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], { stdio: 'pipe' })
    execFileSync('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain], { stdio: 'pipe' })
    console.log('Restored existing encrypted Wavo signing identity to the temporary keychain.')
  } else {
    if (fs.existsSync(file)) {
      console.log('Reusable signing archive already exists; skipping export.')
      process.exit(0)
    }
    const password = randomBytes(32).toString('hex')
    execFileSync('security', ['export', '-k', keychain, '-t', 'identities', '-f', 'pkcs12', '-P', password, '-o', p12Path], { stdio: 'pipe' })
    const p12 = fs.readFileSync(p12Path)
    if (p12.length < 1000) throw Error('Signing identity export was unexpectedly empty')
    const wrapped = encrypt(Buffer.from(JSON.stringify({ p12: p12.toString('base64'), password })))
    // Verify encryption is decryptable before uploading.
    JSON.parse(decrypt(wrapped).toString('utf8'))
    await commitEncrypted(wrapped)
    console.log('Encrypted signing identity saved to GitHub; future CI builds can reuse it.')
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
