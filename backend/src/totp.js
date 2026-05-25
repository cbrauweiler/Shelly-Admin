import crypto from 'node:crypto'

// TOTP nach RFC 6238 (SHA-1, 6 Stellen, 30 s) ohne externe Abhaengigkeiten –
// kompatibel zu Google Authenticator, Aegis, 1Password etc.

const STEP = 30
const DIGITS = 6
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Zufaelliges Base32-Secret (20 Byte -> 32 Zeichen). */
export function generateSecret() {
  const bytes = crypto.randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = ''
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function hotp(secretBytes, counter) {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** Aktuellen TOTP-Code erzeugen (fuer Tests/Debug). */
export const totp = (secret, t = Date.now()) =>
  hotp(base32Decode(secret), Math.floor(t / 1000 / STEP))

/** Code pruefen, mit Toleranz von +/- `window` Zeitschritten gegen Uhren-Drift. */
export function verifyTotp(secret, token, window = 1) {
  const clean = String(token || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const bytes = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / STEP)
  for (let w = -window; w <= window; w++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(bytes, counter + w)), Buffer.from(clean))) {
      return true
    }
  }
  return false
}

/** otpauth://-URI fuer QR-Codes in der Authenticator-App. */
export function otpauthUrl(secret, account, issuer = 'Shelly-Admin') {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP) })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Recovery-Codes erzeugen: Klartext (einmalig anzeigen) + zugehoerige Hashes (speichern). */
export function generateRecoveryCodes(count = 8) {
  const codes = []
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex') // 10 hex-Zeichen
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return codes
}
