import crypto from 'node:crypto'
import { fetchTimeout, round } from './util.js'

// Kommunikation mit Shelly-Geraeten beider Generationen:
//   Gen1   -> klassische REST-Endpunkte (/shelly, /status, /relay/N, /ota)
//   Gen2+  -> JSON-RPC ueber POST /rpc (Shelly.*, Switch.*)
// Geraete-Authentifizierung wird unterstuetzt: HTTP Digest (Gen2, SHA-256) und
// Basic (Gen1) – per Challenge-Response, kein Passwort im Klartext im Request-Log.

// --- HTTP Digest/Basic ------------------------------------------------------

function parseAuthHeader(header) {
  const scheme = header.split(/\s+/)[0]
  const rest = header.slice(scheme.length)
  const params = {}
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g
  let m
  while ((m = re.exec(rest))) params[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  return { scheme: scheme.toLowerCase(), params }
}

function digestHeader({ username, password, method, uri, params }) {
  const algo = (params.algorithm || 'MD5').toUpperCase()
  const h =
    algo.includes('SHA-256') || algo.includes('SHA256')
      ? (s) => crypto.createHash('sha256').update(s).digest('hex')
      : (s) => crypto.createHash('md5').update(s).digest('hex')

  const { realm = '', nonce = '', qop = '', opaque } = params
  const cnonce = crypto.randomBytes(8).toString('hex')
  const nc = '00000001'
  const ha1 = h(`${username}:${realm}:${password}`)
  const ha2 = h(`${method}:${uri}`)
  const response = qop
    ? h(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : h(`${ha1}:${nonce}:${ha2}`)

  let out = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
  if (params.algorithm) out += `, algorithm=${params.algorithm}`
  if (opaque) out += `, opaque="${opaque}"`
  if (qop) out += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`
  return out
}

/** HTTP-Anfrage an ein Geraet inkl. optionaler Digest/Basic-Authentifizierung. */
async function request(host, { method = 'GET', path = '/', body, cred, timeoutMs } = {}) {
  const url = `http://${host}${path}`
  const headers = {}
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res = await fetchTimeout(url, { method, headers, body: payload, timeoutMs })

  if (res.status === 401 && cred?.password) {
    const wa = res.headers.get('www-authenticate') || ''
    const username = cred.username || 'admin' // Gen2 erwartet stets "admin"
    if (/^digest/i.test(wa)) {
      const { params } = parseAuthHeader(wa)
      const auth = digestHeader({ username, password: cred.password, method, uri: path, params })
      res = await fetchTimeout(url, { method, headers: { ...headers, Authorization: auth }, body: payload, timeoutMs })
    } else if (/^basic/i.test(wa)) {
      const basic = 'Basic ' + Buffer.from(`${username}:${cred.password}`).toString('base64')
      res = await fetchTimeout(url, { method, headers: { ...headers, Authorization: basic }, body: payload, timeoutMs })
    }
  }

  if (res.status === 401) {
    const e = new Error('Authentifizierung erforderlich')
    e.code = 'AUTH'
    throw e
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

/** JSON-RPC-Aufruf (Gen2+). Liefert das result-Objekt oder wirft bei error. */
async function rpc(host, method, params, cred, timeoutMs) {
  const json = await request(host, {
    method: 'POST',
    path: '/rpc',
    body: { id: 1, method, params },
    cred,
    timeoutMs,
  })
  if (json?.error) throw new Error(json.error.message || `RPC ${method} fehlgeschlagen`)
  return json?.result ?? json
}

// --- Geraete-Info (/shelly) -------------------------------------------------

function normalizeInfo(info) {
  const gen = Number(info.gen) || 1
  if (gen >= 2) {
    return {
      reachable: true,
      gen,
      model: info.model || info.app || null,
      app: info.app || null,
      mac: (info.mac || '').toUpperCase() || null,
      fw: info.ver || null,
      name: info.name || null,
      authEnabled: Boolean(info.auth_en),
    }
  }
  return {
    reachable: true,
    gen: 1,
    model: info.type || info.model || null,
    app: info.type || null,
    mac: (info.mac || '').toUpperCase() || null,
    fw: info.fw || null,
    name: null,
    authEnabled: Boolean(info.auth),
  }
}

/** Liest /shelly und liefert normalisierte Geraete-Stammdaten (oder wirft). */
export async function probe(host, cred, timeoutMs) {
  const info = await request(host, { path: '/shelly', cred, timeoutMs })
  return normalizeInfo(info)
}

// --- Live-Status ------------------------------------------------------------

function statusGen1(s) {
  const meters = s.meters?.length ? s.meters : s.emeters || []
  const power = meters.reduce((sum, m) => sum + (Number(m.power) || 0), 0)
  const relays = (s.relays || []).map((r, i) => ({ id: i, on: Boolean(r.ison) }))
  const upd = s.update || {}
  return {
    online: true,
    power_w: round(power),
    switches: relays,
    temperature_c: s.temperature ?? s.tmp?.tC ?? null,
    rssi: s.wifi_sta?.rssi ?? null,
    ip: s.wifi_sta?.ip ?? null,
    uptime_s: s.uptime ?? null,
    fw: upd.old_version ?? null,
    update: { available: Boolean(upd.has_update), newVersion: upd.new_version ?? null },
    voltage: meters[0]?.voltage ?? null,
  }
}

function statusGen2(s) {
  const switches = []
  let power = 0
  let temp = null
  let voltage = null
  for (const [k, v] of Object.entries(s)) {
    if (/^switch:\d+$/.test(k)) {
      switches.push({ id: Number(k.split(':')[1]), on: Boolean(v.output) })
      if (typeof v.apower === 'number') power += v.apower
      if (v.temperature?.tC != null) temp = v.temperature.tC
      if (typeof v.voltage === 'number') voltage = v.voltage
    } else if (/^(pm1|em1?):\d+$/.test(k)) {
      const p = v.apower ?? v.act_power ?? v.total_act_power
      if (typeof p === 'number') power += p
    }
  }
  const sys = s.sys || {}
  const upd = sys.available_updates || {}
  const newVer = upd.stable?.version || upd.beta?.version || null
  return {
    online: true,
    power_w: round(power),
    switches,
    temperature_c: temp,
    rssi: s.wifi?.rssi ?? null,
    ip: s.wifi?.sta_ip ?? null,
    uptime_s: sys.uptime ?? null,
    fw: null,
    update: { available: Boolean(newVer), newVersion: newVer },
    voltage,
  }
}

/** Normalisierter Live-Status eines Geraets. */
export async function getStatus(device, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) {
    const [st, di] = await Promise.all([
      rpc(device.host, 'Shelly.GetStatus', undefined, cred, timeoutMs),
      rpc(device.host, 'Shelly.GetDeviceInfo', undefined, cred, timeoutMs).catch(() => ({})),
    ])
    const out = statusGen2(st)
    out.fw = di.ver ?? out.fw
    out.model = di.model ?? device.model
    return out
  }
  const s = await request(device.host, { path: '/status', cred, timeoutMs })
  return statusGen1(s)
}

// --- Steuerung --------------------------------------------------------------

export function setSwitch(device, id, on, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) {
    return rpc(device.host, 'Switch.Set', { id: Number(id), on: Boolean(on) }, cred, timeoutMs)
  }
  return request(device.host, { path: `/relay/${Number(id)}?turn=${on ? 'on' : 'off'}`, cred, timeoutMs })
}

export function reboot(device, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) return rpc(device.host, 'Shelly.Reboot', undefined, cred, timeoutMs)
  return request(device.host, { path: '/reboot', cred, timeoutMs })
}

export function checkUpdate(device, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) return rpc(device.host, 'Shelly.CheckForUpdate', undefined, cred, timeoutMs)
  return request(device.host, { path: '/ota/check', cred, timeoutMs })
}

export function installUpdate(device, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) return rpc(device.host, 'Shelly.Update', { stage: 'stable' }, cred, timeoutMs)
  return request(device.host, { path: '/ota?update=true', cred, timeoutMs })
}
