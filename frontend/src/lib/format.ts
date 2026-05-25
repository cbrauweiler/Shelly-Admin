export const fmtW = (w?: number | null): string => {
  if (w == null) return '–'
  const a = Math.abs(w)
  if (a >= 1000) return `${(w / 1000).toFixed(2)} kW`
  return `${Math.round(w)} W`
}

export const fmtTemp = (c?: number | null): string => (c == null ? '–' : `${Math.round(c)} °C`)

export const fmtVolt = (v?: number | null): string => (v == null ? '–' : `${Math.round(v)} V`)

/** Uptime-Sekunden -> "3d 4h" / "4h 12m" / "12m". */
export const fmtUptime = (s?: number | null): string => {
  if (s == null) return '–'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** WLAN-Signal aus RSSI (dBm) als Balken-Anzahl 0–4. */
export const rssiBars = (rssi?: number | null): number => {
  if (rssi == null) return 0
  if (rssi >= -55) return 4
  if (rssi >= -65) return 3
  if (rssi >= -75) return 2
  if (rssi >= -85) return 1
  return 0
}

/** ISO-Zeit -> relative Angabe ("vor 2 min", "vor 3 h", "gestern"). */
export const fmtRelative = (iso?: string | null): string => {
  if (!iso) return 'nie'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'gestern' : `vor ${d} Tagen`
}

export const genLabel = (gen: number): string => (gen >= 2 ? `Gen${gen}` : 'Gen1')
