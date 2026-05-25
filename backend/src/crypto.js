import crypto from 'node:crypto'

// --- Passwort-Hashing (scrypt) ---------------------------------------------

/** Passwort -> { hash, salt } (beide hex). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, 64)
  return { hash: hash.toString('hex'), salt: salt.toString('hex') }
}

/** Konstantzeit-Vergleich eines Passworts gegen gespeicherten Hash. */
export function verifyPassword(password, hashHex, saltHex) {
  if (!hashHex || !saltHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(String(password), salt, expected.length)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

export const safeEqualStr = (x, y) => {
  const bx = Buffer.from(String(x))
  const by = Buffer.from(String(y))
  return bx.length === by.length && crypto.timingSafeEqual(bx, by)
}

export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

// --- HMAC-signierte Session-Tokens -----------------------------------------

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const hmac = (secret, data) =>
  crypto.createHmac('sha256', secret).update(data).digest('base64url')

/** Signiertes Token mit beliebigem Payload + Ablaufzeit erzeugen. */
export function signToken(secret, payload, ttlMs) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }))
  return `${body}.${hmac(secret, body)}`
}

/** Token pruefen -> Payload oder null. */
export function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = hmac(secret, body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null
    return data
  } catch {
    return null
  }
}

// --- Symmetrische Verschluesselung (Geraete-Zugangsdaten) ------------------
// AES-256-GCM. Schluessel wird aus dem Instanz-Secret abgeleitet.

const keyFromSecret = (secret) => crypto.createHash('sha256').update('shadm:' + secret).digest()

export function encrypt(plaintext, secret) {
  if (plaintext == null || plaintext === '') return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
}

export function decrypt(blob, secret) {
  if (!blob) return null
  try {
    const [ivB, tagB, dataB] = blob.split('.')
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyFromSecret(secret),
      Buffer.from(ivB, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
    return decipher.update(Buffer.from(dataB, 'base64url'), undefined, 'utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}
