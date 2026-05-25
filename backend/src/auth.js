import { config } from './config.js'
import { getDb, update, secret as storeSecret } from './store.js'
import {
  hashPassword,
  verifyPassword,
  safeEqualStr,
  sha256hex,
  signToken,
  verifyToken,
} from './crypto.js'
import { generateSecret, otpauthUrl, generateRecoveryCodes, verifyTotp } from './totp.js'

const COOKIE = 'sa_session'
const PENDING_TTL_MS = 5 * 60_000

// Signier-Geheimnis: explizit konfiguriert, sonst stabiles Instanz-Secret aus dem Store.
const sigSecret = () => (config.auth.secret?.length ? config.auth.secret : storeSecret())

const admin = () => getDb().admin

export const needsSetup = () => !admin()
export const mfaEnabled = () => Boolean(admin()?.mfa?.enabled)

// --- Cookies ---------------------------------------------------------------

function setCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  })
}

function parseCookies(req) {
  const out = {}
  const raw = req.headers.cookie
  if (!raw) return out
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

const session = (req) => verifyToken(sigSecret(), parseCookies(req)[COOKIE])

// --- Rate-Limit fuer Login-Versuche ----------------------------------------

const attempts = new Map() // ip -> { count, resetAt }
const WINDOW_MS = 5 * 60_000
const MAX_ATTEMPTS = 10

function rateLimited(ip) {
  const now = Date.now()
  const e = attempts.get(ip)
  if (!e || e.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  e.count += 1
  return e.count > MAX_ATTEMPTS
}

// --- Middleware ------------------------------------------------------------

/** Schuetzt Routen: erfordert eine vollwertige (nicht "pending") Session. */
export function requireAuth(req, res, next) {
  const s = session(req)
  if (s && s.lvl === 'full') return next()
  res.status(401).json({ error: 'unauthorized' })
}

// --- Setup (Erst-Aufruf) ---------------------------------------------------

/** Oeffentlicher Status fuer das Frontend. */
export function stateHandler(req, res) {
  const s = session(req)
  res.json({
    needsSetup: needsSetup(),
    authed: Boolean(s && s.lvl === 'full'),
    controlMode: config.controlMode,
    refreshSeconds: config.refreshSeconds,
    defaultSubnet: config.defaultSubnet,
  })
}

/** Legt das Admin-Konto an – nur moeglich, solange keines existiert. */
export async function setupHandler(req, res) {
  if (!needsSetup()) return res.status(409).json({ error: 'Setup bereits abgeschlossen.' })
  const { username = '', password = '', enableMfa = false } = req.body ?? {}
  if (String(username).trim().length < 3) {
    return res.status(400).json({ error: 'Benutzername: mindestens 3 Zeichen.' })
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Passwort: mindestens 8 Zeichen.' })
  }

  const { hash, salt } = hashPassword(password)
  let mfaProvisioning = null

  await update((db) => {
    db.admin = {
      username: String(username).trim(),
      passHash: hash,
      passSalt: salt,
      mfa: null,
      createdAt: new Date().toISOString(),
    }
    if (enableMfa) {
      const sec = generateSecret()
      const recovery = generateRecoveryCodes()
      // Noch nicht aktiv: erst nach Bestaetigung eines Codes (enableMfaHandler).
      db.admin.mfa = { enabled: false, secret: sec, recoveryHashes: recovery.map(sha256hex) }
      mfaProvisioning = {
        secret: sec,
        otpauthUrl: otpauthUrl(sec, db.admin.username),
        recoveryCodes: recovery,
      }
    }
  })

  // Direkt vollwertig einloggen (Passwort wurde gerade gesetzt).
  setCookie(res, signToken(sigSecret(), { lvl: 'full' }, config.auth.sessionHours * 3600_000), config.auth.sessionHours * 3600_000)
  res.json({ ok: true, mfa: mfaProvisioning })
}

// --- MFA verwalten ---------------------------------------------------------

/** Erzeugt ein neues TOTP-Secret + Recovery-Codes (noch nicht aktiv). */
export async function beginMfaHandler(_req, res) {
  const sec = generateSecret()
  const recovery = generateRecoveryCodes()
  await update((db) => {
    db.admin.mfa = { enabled: false, secret: sec, recoveryHashes: recovery.map(sha256hex) }
  })
  res.json({
    secret: sec,
    otpauthUrl: otpauthUrl(sec, admin().username),
    recoveryCodes: recovery,
  })
}

/** Aktiviert MFA nach Bestaetigung eines gueltigen Codes. */
export async function enableMfaHandler(req, res) {
  const m = admin()?.mfa
  if (!m?.secret) return res.status(400).json({ error: 'Kein MFA-Setup vorhanden.' })
  const { code = '' } = req.body ?? {}
  if (!verifyTotp(m.secret, code)) return res.status(400).json({ error: 'Code ungueltig.' })
  await update((db) => {
    db.admin.mfa.enabled = true
  })
  res.json({ ok: true })
}

/** Deaktiviert MFA (Passwort erforderlich). */
export async function disableMfaHandler(req, res) {
  const { password = '' } = req.body ?? {}
  const a = admin()
  if (!verifyPassword(password, a.passHash, a.passSalt)) {
    return res.status(401).json({ error: 'Passwort falsch.' })
  }
  await update((db) => {
    db.admin.mfa = null
  })
  res.json({ ok: true })
}

export function accountHandler(_req, res) {
  res.json({ username: admin().username, mfaEnabled: mfaEnabled() })
}

// --- Login -----------------------------------------------------------------

export function loginHandler(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte spaeter erneut.' })
  }
  const a = admin()
  if (!a) return res.status(409).json({ error: 'Kein Konto vorhanden.' })

  const { username = '', password = '' } = req.body ?? {}
  const userOk = safeEqualStr(String(username), a.username)
  const passOk = String(password).length > 0 && verifyPassword(password, a.passHash, a.passSalt)
  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Falsche Zugangsdaten.' })
  }

  if (a.mfa?.enabled) {
    // Zwischenschritt: kurzlebige "pending"-Session bis zur MFA-Bestaetigung.
    setCookie(res, signToken(sigSecret(), { lvl: 'pending' }, PENDING_TTL_MS), PENDING_TTL_MS)
    return res.json({ ok: true, mfaRequired: true })
  }

  setCookie(res, signToken(sigSecret(), { lvl: 'full' }, config.auth.sessionHours * 3600_000), config.auth.sessionHours * 3600_000)
  res.json({ ok: true, mfaRequired: false })
}

/** Zweiter Login-Schritt: TOTP-Code ODER Recovery-Code. */
export async function loginMfaHandler(req, res) {
  const s = session(req)
  if (!s || (s.lvl !== 'pending' && s.lvl !== 'full')) {
    return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.' })
  }
  const m = admin()?.mfa
  if (!m?.enabled) return res.status(400).json({ error: 'MFA ist nicht aktiv.' })

  const { code = '' } = req.body ?? {}
  const clean = String(code).trim()

  let ok = verifyTotp(m.secret, clean)
  if (!ok) {
    // Recovery-Code? Hash vergleichen und bei Treffer verbrauchen.
    const h = sha256hex(clean.toLowerCase())
    if (m.recoveryHashes?.includes(h)) {
      ok = true
      await update((db) => {
        db.admin.mfa.recoveryHashes = db.admin.mfa.recoveryHashes.filter((x) => x !== h)
      })
    }
  }
  if (!ok) return res.status(401).json({ error: 'Code ungueltig.' })

  setCookie(res, signToken(sigSecret(), { lvl: 'full' }, config.auth.sessionHours * 3600_000), config.auth.sessionHours * 3600_000)
  res.json({ ok: true })
}

export function logoutHandler(_req, res) {
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
}
