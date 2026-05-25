import express from 'express'
import crypto from 'node:crypto'
import { config, canControl, canUpdate } from './config.js'
import { getDb, update, persist, secret } from './store.js'
import { encrypt, decrypt } from './crypto.js'
import { iso, pool } from './util.js'
import * as shelly from './shelly.js'
import { scanSubnet } from './discovery.js'
import {
  requireAuth,
  stateHandler,
  setupHandler,
  loginHandler,
  loginMfaHandler,
  logoutHandler,
  accountHandler,
  beginMfaHandler,
  enableMfaHandler,
  disableMfaHandler,
} from './auth.js'

const app = express()
app.set('trust proxy', true) // hinter dem Synology-Reverse-Proxy: korrekte IP/Protokoll
app.use(express.json())

// Einheitliches Fehler-Handling fuer async-Routen.
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (e) {
    if (e?.code === 'AUTH') {
      return res.status(502).json({ error: 'Geraet erfordert Zugangsdaten (Geraete-Auth aktiv).' })
    }
    console.error('[api]', e?.message ?? e)
    res.status(500).json({ error: String(e?.message ?? e) })
  }
}

const normHost = (h) =>
  String(h || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')

const findDevice = (id) => getDb().devices.find((d) => d.id === id)

// Entschluesselte Zugangsdaten fuer ein Geraet (oder null).
const credFor = (d) =>
  d.auth?.enabled
    ? { username: d.auth.username || 'admin', password: decrypt(d.auth.passwordEnc, secret()) }
    : null

// Nach aussen sichtbare Geraetefelder (ohne Secrets).
const publicDevice = (d) => ({
  id: d.id,
  name: d.name,
  host: d.host,
  gen: d.gen,
  model: d.model,
  mac: d.mac,
  fw: d.fw ?? null,
  tags: d.tags ?? [],
  addedAt: d.addedAt,
  lastSeen: d.lastSeen ?? null,
  auth: d.auth ? { enabled: !!d.auth.enabled, username: d.auth.username || 'admin', hasPassword: !!d.auth.passwordEnc } : null,
})

// lastSeen-Aktualisierungen gedrosselt auf Platte schreiben (Status-Polling).
let lastSeenPersistAt = 0
function touchLastSeen() {
  const now = Date.now()
  if (now - lastSeenPersistAt > 30_000) {
    lastSeenPersistAt = now
    persist()
  }
}

// === Health & oeffentliche Auth-Routen =====================================

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/state', stateHandler)
app.post('/api/setup', wrap(setupHandler))
app.post('/api/login', loginHandler)
app.post('/api/login/mfa', wrap(loginMfaHandler))
app.post('/api/logout', logoutHandler)

// === Ab hier: Login erforderlich ===========================================

app.use('/api', requireAuth)

app.get('/api/account', accountHandler)
app.post('/api/mfa/begin', wrap(beginMfaHandler))
app.post('/api/mfa/enable', wrap(enableMfaHandler))
app.post('/api/mfa/disable', wrap(disableMfaHandler))

// --- Geraeteliste (persistiert, ohne Live-Abfrage) -------------------------
app.get('/api/devices', (_req, res) => {
  res.json({ devices: getDb().devices.map(publicDevice) })
})

// --- Geraet manuell hinzufuegen --------------------------------------------
app.post(
  '/api/devices',
  wrap(async (req, res) => {
    const host = normHost(req.body?.host)
    if (!host) return res.status(400).json({ error: 'Host/IP fehlt.' })

    const db = getDb()
    if (db.devices.some((d) => d.host === host)) {
      return res.status(409).json({ error: 'Geraet mit dieser Adresse existiert bereits.' })
    }

    const username = req.body?.username || ''
    const password = req.body?.password || ''
    const cred = password ? { username: username || 'admin', password } : null

    const info = await shelly.probe(host, cred, config.deviceTimeoutMs)

    const auth =
      password
        ? { enabled: true, username: username || 'admin', passwordEnc: encrypt(password, secret()) }
        : info.authEnabled
          ? { enabled: true, username: 'admin', passwordEnc: null } // Auth aktiv, aber kein Passwort hinterlegt
          : null

    const device = {
      id: crypto.randomUUID(),
      name: String(req.body?.name || '').trim() || info.name || info.model || host,
      host,
      gen: info.gen,
      model: info.model,
      mac: info.mac,
      fw: info.fw,
      auth,
      tags: [],
      addedAt: iso(),
      lastSeen: iso(),
    }
    await update((d) => d.devices.push(device))
    res.status(201).json(publicDevice(device))
  }),
)

// --- Geraet bearbeiten (Name, Tags, Zugangsdaten) --------------------------
app.patch(
  '/api/devices/:id',
  wrap(async (req, res) => {
    const d = findDevice(req.params.id)
    if (!d) return res.status(404).json({ error: 'Geraet nicht gefunden.' })

    if (typeof req.body?.name === 'string') d.name = req.body.name.trim() || d.name
    if (Array.isArray(req.body?.tags)) d.tags = req.body.tags.map(String)

    // Zugangsdaten: password === '' -> Auth entfernen; nicht-leer -> setzen.
    if ('password' in (req.body ?? {})) {
      const password = req.body.password || ''
      const username = req.body.username || d.auth?.username || 'admin'
      d.auth = password
        ? { enabled: true, username, passwordEnc: encrypt(password, secret()) }
        : null
    } else if (typeof req.body?.username === 'string' && d.auth) {
      d.auth.username = req.body.username || 'admin'
    }

    await persist()
    res.json(publicDevice(d))
  }),
)

// --- Geraet entfernen ------------------------------------------------------
app.delete(
  '/api/devices/:id',
  wrap(async (req, res) => {
    const db = getDb()
    const before = db.devices.length
    db.devices = db.devices.filter((d) => d.id !== req.params.id)
    if (db.devices.length === before) return res.status(404).json({ error: 'Geraet nicht gefunden.' })
    await persist()
    res.json({ ok: true })
  }),
)

// --- Live-Status aller Geraete (parallel) ----------------------------------
app.get(
  '/api/devices/status',
  wrap(async (_req, res) => {
    const devices = getDb().devices
    const out = await pool(devices, 16, async (d) => {
      try {
        const status = await shelly.getStatus(d, credFor(d), config.deviceTimeoutMs)
        d.lastSeen = iso()
        if (status.fw) d.fw = status.fw
        if (status.model) d.model = status.model
        return { ...publicDevice(d), online: true, status }
      } catch (e) {
        return { ...publicDevice(d), online: false, status: null, error: String(e?.message ?? e) }
      }
    })
    touchLastSeen()
    res.json({ devices: out })
  }),
)

// --- Live-Status eines Geraets ---------------------------------------------
app.get(
  '/api/devices/:id/status',
  wrap(async (req, res) => {
    const d = findDevice(req.params.id)
    if (!d) return res.status(404).json({ error: 'Geraet nicht gefunden.' })
    try {
      const status = await shelly.getStatus(d, credFor(d), config.deviceTimeoutMs)
      d.lastSeen = iso()
      touchLastSeen()
      res.json({ ...publicDevice(d), online: true, status })
    } catch (e) {
      res.json({ ...publicDevice(d), online: false, status: null, error: String(e?.message ?? e) })
    }
  }),
)

// --- Steuerung -------------------------------------------------------------
const needControl = (req, res, next) =>
  canControl() ? next() : res.status(403).json({ error: 'Steuerung deaktiviert (CONTROL_MODE).' })
const needUpdate = (req, res, next) =>
  canUpdate() ? next() : res.status(403).json({ error: 'Updates deaktiviert (CONTROL_MODE).' })

app.post(
  '/api/devices/:id/switch',
  needControl,
  wrap(async (req, res) => {
    const d = findDevice(req.params.id)
    if (!d) return res.status(404).json({ error: 'Geraet nicht gefunden.' })
    const out = await shelly.setSwitch(d, req.body?.id ?? 0, !!req.body?.on, credFor(d), config.deviceTimeoutMs)
    res.json({ ok: true, result: out })
  }),
)

app.post(
  '/api/devices/:id/reboot',
  needControl,
  wrap(async (req, res) => {
    const d = findDevice(req.params.id)
    if (!d) return res.status(404).json({ error: 'Geraet nicht gefunden.' })
    await shelly.reboot(d, credFor(d), config.deviceTimeoutMs)
    res.json({ ok: true })
  }),
)

app.post(
  '/api/devices/:id/check-update',
  needUpdate,
  wrap(async (req, res) => {
    const d = findDevice(req.params.id)
    if (!d) return res.status(404).json({ error: 'Geraet nicht gefunden.' })
    const out = await shelly.checkUpdate(d, credFor(d), config.deviceTimeoutMs)
    res.json({ ok: true, result: out })
  }),
)

app.post(
  '/api/devices/:id/update',
  needUpdate,
  wrap(async (req, res) => {
    const d = findDevice(req.params.id)
    if (!d) return res.status(404).json({ error: 'Geraet nicht gefunden.' })
    const out = await shelly.installUpdate(d, credFor(d), config.deviceTimeoutMs)
    res.json({ ok: true, result: out })
  }),
)

// --- Discovery: Subnetz scannen --------------------------------------------
app.post(
  '/api/discover',
  wrap(async (req, res) => {
    const subnet = req.body?.subnet || config.defaultSubnet
    if (!subnet) return res.status(400).json({ error: 'Subnetz angeben, z. B. 192.168.1.0/24' })
    const known = new Set(getDb().devices.map((d) => d.host))
    const result = await scanSubnet(subnet, known)
    res.json(result)
  }),
)

// --- Discovery-Ergebnisse uebernehmen (Bulk-Add) ---------------------------
app.post(
  '/api/devices/import',
  wrap(async (req, res) => {
    const list = Array.isArray(req.body?.devices) ? req.body.devices : []
    const db = getDb()
    const added = []
    const skipped = []
    for (const item of list) {
      const host = normHost(item?.host)
      if (!host || db.devices.some((d) => d.host === host)) {
        skipped.push(host)
        continue
      }
      try {
        const info = await shelly.probe(host, null, config.deviceTimeoutMs)
        const device = {
          id: crypto.randomUUID(),
          name: String(item?.name || '').trim() || info.name || info.model || host,
          host,
          gen: info.gen,
          model: info.model,
          mac: info.mac,
          fw: info.fw,
          auth: info.authEnabled ? { enabled: true, username: 'admin', passwordEnc: null } : null,
          tags: [],
          addedAt: iso(),
          lastSeen: iso(),
        }
        db.devices.push(device)
        added.push(publicDevice(device))
      } catch {
        skipped.push(host)
      }
    }
    await persist()
    res.json({ added, skipped })
  }),
)

app.listen(config.port, () => {
  console.log(`Shelly-Admin backend laeuft auf http://localhost:${config.port}  (CONTROL_MODE=${config.controlMode})`)
})
