// Kleine Hilfsfunktionen ohne externe Abhaengigkeiten.

export const iso = (d = new Date()) => new Date(d).toISOString()

export const round = (n, d = 0) => {
  if (n == null || Number.isNaN(n)) return null
  const f = 10 ** d
  return Math.round(n * f) / f
}

/** Promise, das nach ms verworfen wird (fuer AbortController-Timeouts). */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * fetch mit Timeout. Bricht nach ms ab und wirft einen lesbaren Fehler.
 */
export async function fetchTimeout(url, { timeoutMs = 2500, ...opts } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Zeitueberschreitung')
    throw new Error(e?.cause?.code || e?.message || String(e))
  } finally {
    clearTimeout(t)
  }
}

/**
 * Fuehrt eine async-Funktion mit begrenzter Parallelitaet ueber alle items aus.
 * Ergebnisse in Eingabereihenfolge; Fehler je Element werden als { error } geliefert.
 */
export async function pool(items, concurrency, fn) {
  const results = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try {
        results[idx] = await fn(items[idx], idx)
      } catch (e) {
        results[idx] = { error: String(e?.message ?? e) }
      }
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * "192.168.1.0/24" oder "192.168.1" -> Liste scanbarer Host-Adressen (.1 .. .254).
 * Unterstuetzt vorerst /24 (klassisches Heimnetz). Wirft bei ungueltiger Eingabe.
 */
export function expandSubnet(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('Kein Subnetz angegeben')

  let base = raw
  if (raw.includes('/')) {
    const [addr, bits] = raw.split('/')
    if (Number(bits) !== 24) throw new Error('Nur /24-Subnetze werden unterstuetzt')
    base = addr
  }
  const parts = base.split('.').filter(Boolean)
  if (parts.length < 3 || parts.length > 4) throw new Error('Ungueltiges Subnetz')
  const [a, b, c] = parts.map((p) => Number(p))
  if ([a, b, c].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error('Ungueltiges Subnetz')
  }
  const hosts = []
  for (let h = 1; h <= 254; h++) hosts.push(`${a}.${b}.${c}.${h}`)
  return hosts
}

/** Uptime-Sekunden -> "3d 4h" / "12m" o. ae. */
export const fmtUptime = (s) => {
  if (s == null) return null
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
