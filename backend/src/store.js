import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

// Einfache, dateibasierte Persistenz (eine JSON-Datei). Bewusst ohne native
// Abhaengigkeit gehalten; die Datenmenge (1 Admin + N Geraete) ist klein.
//
// Schema (version 1):
// {
//   version, secret,                              // Instanz-Secret (Signieren/Verschluesseln)
//   admin: { username, passHash, passSalt,
//            mfa: { enabled, secret, recoveryHashes[] } | null, createdAt } | null,
//   devices: [ { id, name, host, gen, model, mac, generation,
//                auth: { enabled, username, passwordEnc } | null,
//                tags[], addedAt, lastSeen } ],
//   settings: {}
// }

const FILE = path.join(config.dataDir, 'shelly-admin.json')
const TMP = FILE + '.tmp'

const emptyDb = () => ({
  version: 1,
  secret: crypto.randomBytes(32).toString('hex'),
  admin: null,
  devices: [],
  settings: {},
})

let db = null
let writeChain = Promise.resolve()

function load() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    const raw = fs.readFileSync(FILE, 'utf8')
    db = JSON.parse(raw)
    if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex')
    if (!Array.isArray(db.devices)) db.devices = []
  } catch {
    db = emptyDb()
    // Erst-Initialisierung sofort persistieren, damit das Secret stabil bleibt.
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2))
  }
  return db
}

export function getDb() {
  if (!db) load()
  return db
}

export const secret = () => getDb().secret

/**
 * Persistiert den aktuellen In-Memory-Stand atomar (temp-Datei + rename).
 * Schreibvorgaenge werden serialisiert, um Races zu vermeiden.
 */
export function persist() {
  const snapshot = JSON.stringify(getDb(), null, 2)
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      await fsp.writeFile(TMP, snapshot)
      await fsp.rename(TMP, FILE)
    })
  return writeChain
}

/** Mutiert die DB ueber fn und persistiert anschliessend. Liefert den Rueckgabewert von fn. */
export async function update(fn) {
  const result = fn(getDb())
  await persist()
  return result
}
