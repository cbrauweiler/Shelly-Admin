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
    // has_update = Stable verfuegbar; beta_version = neuere Beta (separat, nicht "available")
    update: {
      available: Boolean(upd.has_update),
      newVersion: upd.new_version ?? null,
      beta: upd.beta_version ?? null,
    },
    voltage: meters[0]?.voltage ?? null,
  }
}

// Schaltbare Komponenten-Familien (Gen2+). RGBW/Dimmer melden statt "switch"
// z. B. "light", "rgbw", "rgb", "cct", "white" – alle mit "output".
const OUTPUT_TYPES = new Set(['switch', 'light', 'rgb', 'rgbw', 'cct', 'white'])

function statusGen2(s) {
  const switches = []
  let power = 0
  let temp = null
  let voltage = null
  for (const [k, v] of Object.entries(s)) {
    if (!v || typeof v !== 'object') continue
    const [fam, idStr] = k.split(':')
    if (OUTPUT_TYPES.has(fam) && idStr !== undefined) {
      switches.push({ id: Number(idStr), on: Boolean(v.output), type: fam })
      if (typeof v.apower === 'number') power += v.apower
      if (v.temperature?.tC != null) temp = v.temperature.tC
      if (typeof v.voltage === 'number') voltage = v.voltage
    } else if (fam === 'pm1' || fam === 'em' || fam === 'em1') {
      const p = v.apower ?? v.act_power ?? v.total_act_power
      if (typeof p === 'number') power += p
    }
  }
  const sys = s.sys || {}
  const upd = sys.available_updates || {}
  // Nur ein Stable-Update ist "verfuegbar" (wir aktualisieren standardmaessig auf Stable).
  // Beta-Versionen werden separat gefuehrt (nur informativ / optional installierbar).
  const stable = upd.stable?.version || null
  const beta = upd.beta?.version || null
  return {
    online: true,
    power_w: round(power),
    switches,
    temperature_c: temp,
    rssi: s.wifi?.rssi ?? null,
    ip: s.wifi?.sta_ip ?? null,
    uptime_s: sys.uptime ?? null,
    fw: null,
    update: { available: Boolean(stable), newVersion: stable, beta },
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

// Komponenten-Familie -> passende RPC-Set-Methode (Gen2+).
const SET_METHOD = {
  switch: 'Switch.Set',
  light: 'Light.Set',
  rgb: 'RGB.Set',
  rgbw: 'RGBW.Set',
  cct: 'CCT.Set',
  white: 'White.Set',
}

export function setSwitch(device, id, on, type, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) {
    const method = SET_METHOD[type] || 'Switch.Set'
    return rpc(device.host, method, { id: Number(id), on: Boolean(on) }, cred, timeoutMs)
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

export function installUpdate(device, stage, cred, timeoutMs) {
  const channel = stage === 'beta' ? 'beta' : 'stable'
  if ((device.gen || 1) >= 2) {
    return rpc(device.host, 'Shelly.Update', { stage: channel }, cred, timeoutMs)
  }
  return request(device.host, {
    path: channel === 'beta' ? '/ota?beta=true' : '/ota?update=true',
    cred,
    timeoutMs,
  })
}

// --- Dienste lesen/konfigurieren (MQTT, Bluetooth, Access Point, Cloud) -----

const unsupported = { supported: false }

/** Normalisierte Dienst-Konfiguration eines Geraets (Passwoerter werden nie zurueckgegeben). */
export async function getServices(device, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) {
    const [mqtt, ble, cloud, wifi] = await Promise.all([
      rpc(device.host, 'MQTT.GetConfig', undefined, cred, timeoutMs).catch(() => null),
      rpc(device.host, 'BLE.GetConfig', undefined, cred, timeoutMs).catch(() => null),
      rpc(device.host, 'Cloud.GetConfig', undefined, cred, timeoutMs).catch(() => null),
      rpc(device.host, 'WiFi.GetConfig', undefined, cred, timeoutMs).catch(() => null),
    ])
    return {
      mqtt: mqtt
        ? {
            supported: true,
            enable: !!mqtt.enable,
            server: mqtt.server || '',
            user: mqtt.user || '',
            clientId: mqtt.client_id || '',
            prefix: mqtt.topic_prefix || '',
          }
        : unsupported,
      ble: ble
        ? { supported: true, enable: !!ble.enable, rpcEnable: !!ble.rpc?.enable }
        : unsupported,
      ap: wifi?.ap
        ? { supported: true, enable: !!wifi.ap.enable, ssid: wifi.ap.ssid || '', isOpen: !!wifi.ap.is_open }
        : unsupported,
      cloud: cloud ? { supported: true, enable: !!cloud.enable, server: cloud.server || '' } : unsupported,
    }
  }

  // Gen1: alles in /settings
  const s = await request(device.host, { path: '/settings', cred, timeoutMs })
  return {
    mqtt: s.mqtt
      ? {
          supported: true,
          enable: !!s.mqtt.enable,
          server: s.mqtt.server || '',
          user: s.mqtt.user || '',
          clientId: s.mqtt.id || '',
          prefix: s.mqtt.id || '', // Gen1: die ID ist zugleich das Topic-Prefix
        }
      : unsupported,
    ble: unsupported, // Gen1 hat kein Bluetooth
    ap: s.wifi_ap
      ? { supported: true, enable: !!s.wifi_ap.enabled, ssid: s.wifi_ap.ssid || '', isOpen: !s.wifi_ap.key }
      : unsupported,
    cloud: s.cloud
      ? { supported: true, enable: !!s.cloud.enabled, connected: !!s.cloud.connected }
      : unsupported,
  }
}

const qs = (obj) => '?' + new URLSearchParams(obj).toString()

/** Einen Dienst konfigurieren. patch je Dienst, Passwoerter optional (nur bei Aenderung). */
export async function setService(device, service, patch, cred, timeoutMs) {
  const gen2 = (device.gen || 1) >= 2
  const enable = !!patch.enable

  if (service === 'mqtt') {
    if (gen2) {
      const config = { enable }
      if (patch.server !== undefined) config.server = patch.server || null
      if (patch.user !== undefined) config.user = patch.user || null
      if (patch.password) config.pass = patch.password
      if (patch.clientId) config.client_id = patch.clientId
      if (patch.prefix !== undefined) config.topic_prefix = patch.prefix || null
      return rpc(device.host, 'MQTT.SetConfig', { config }, cred, timeoutMs)
    }
    const p = { mqtt_enable: String(enable) }
    if (patch.server !== undefined) p.mqtt_server = patch.server
    if (patch.user !== undefined) p.mqtt_user = patch.user
    if (patch.password) p.mqtt_pass = patch.password
    // Gen1: Topic-Prefix == Geraete-ID (mqtt_id)
    const gen1Id = patch.prefix ?? patch.clientId
    if (gen1Id !== undefined) p.mqtt_id = gen1Id
    return request(device.host, { path: '/settings/mqtt' + qs(p), cred, timeoutMs })
  }

  if (service === 'cloud') {
    if (gen2) {
      const config = { enable }
      if (patch.server) config.server = patch.server
      return rpc(device.host, 'Cloud.SetConfig', { config }, cred, timeoutMs)
    }
    return request(device.host, { path: '/settings/cloud' + qs({ enabled: String(enable) }), cred, timeoutMs })
  }

  if (service === 'ap') {
    if (gen2) {
      const ap = { enable }
      if (patch.ssid) ap.ssid = patch.ssid
      if (patch.password) {
        ap.pass = patch.password
        ap.is_open = false
      }
      return rpc(device.host, 'WiFi.SetConfig', { config: { ap } }, cred, timeoutMs)
    }
    const p = { enabled: String(enable) }
    if (patch.ssid) p.ssid = patch.ssid
    if (patch.password) p.key = patch.password
    return request(device.host, { path: '/settings/ap' + qs(p), cred, timeoutMs })
  }

  if (service === 'ble') {
    if (!gen2) throw new Error('Bluetooth wird von Gen1-Geraeten nicht unterstuetzt.')
    const config = { enable }
    if (patch.rpcEnable !== undefined) config.rpc = { enable: !!patch.rpcEnable }
    return rpc(device.host, 'BLE.SetConfig', { config }, cred, timeoutMs)
  }

  throw new Error('Unbekannter Dienst: ' + service)
}

/** Setzt den Geraete-Namen am Geraet selbst (Gen2: Sys.SetConfig, Gen1: /settings?name=). */
export function setName(device, name, cred, timeoutMs) {
  if ((device.gen || 1) >= 2) {
    return rpc(device.host, 'Sys.SetConfig', { config: { device: { name: name || null } } }, cred, timeoutMs)
  }
  return request(device.host, { path: '/settings' + qs({ name: name || '' }), cred, timeoutMs })
}
