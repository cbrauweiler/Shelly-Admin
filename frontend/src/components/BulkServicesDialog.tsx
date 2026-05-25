import { useState } from 'react'
import { bulkSetService, type DeviceStatus, type ServiceName, type BulkResult } from '../api'
import { Modal, Button, inputClass } from './ui'
import { genLabel } from '../lib/format'

const TABS: { key: ServiceName; label: string; icon: string }[] = [
  { key: 'mqtt', label: 'MQTT', icon: '📡' },
  { key: 'cloud', label: 'Cloud', icon: '☁️' },
  { key: 'ble', label: 'Bluetooth', icon: '🔵' },
  { key: 'ap', label: 'Access Point', icon: '📶' },
]

/** Einen Dienst auf mehreren Geräten gleichzeitig konfigurieren. */
export function BulkServicesDialog({ devices, onClose }: { devices: DeviceStatus[]; onClose: () => void }) {
  const [service, setService] = useState<ServiceName>('mqtt')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(devices.filter((d) => d.online).map((d) => d.id)))
  const [enable, setEnable] = useState(true)
  const [server, setServer] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [prefix, setPrefix] = useState('')
  const [ssid, setSsid] = useState('')
  const [rpcEnable, setRpcEnable] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<BulkResult[] | null>(null)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Leere Felder werden NICHT übertragen (überschreiben also nichts) – nur "enable" immer.
  function buildConfig(): Record<string, unknown> {
    const c: Record<string, unknown> = { enable }
    if (service === 'mqtt') {
      if (server.trim()) c.server = server.trim()
      if (prefix.trim()) c.prefix = prefix.trim()
      if (user.trim()) c.user = user.trim()
      if (password) c.password = password
    } else if (service === 'ble') {
      c.rpcEnable = rpcEnable
    } else if (service === 'ap') {
      if (ssid.trim()) c.ssid = ssid.trim()
      if (password) c.password = password
    }
    return c
  }

  async function apply() {
    setApplying(true)
    setError('')
    setResults(null)
    try {
      const r = await bulkSetService([...selected], service, buildConfig())
      setResults(r.results)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal title="Dienste – Massenaktion" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-line bg-panel2/50 p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setService(t.key)
              setResults(null)
            }}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${service === t.key ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-panel2/40 p-3">
        <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} /> aktiviert
        </label>
        {service === 'mqtt' && enable && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputClass} value={server} onChange={(e) => setServer(e.target.value)} placeholder="Server (host:1883) – leer = unverändert" />
            <input className={inputClass} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Topic-Prefix – leer = unverändert" autoComplete="off" />
            <input className={inputClass} value={user} onChange={(e) => setUser(e.target.value)} placeholder="Benutzer – leer = unverändert" autoComplete="off" />
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort – leer = unverändert" autoComplete="off" />
          </div>
        )}
        {service === 'ble' && enable && (
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={rpcEnable} onChange={(e) => setRpcEnable(e.target.checked)} /> Bluetooth-RPC
          </label>
        )}
        {service === 'ap' && enable && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputClass} value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="SSID – leer = unverändert" />
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort – leer = unverändert" autoComplete="off" />
          </div>
        )}
        {service === 'cloud' && (
          <p className="text-xs text-muted">Cloud-Fernzugriff auf den gewählten Geräten {enable ? 'aktivieren' : 'deaktivieren'}.</p>
        )}
        {service === 'ble' && <p className="mt-2 text-[11px] text-muted">Gen1-Geräte ohne Bluetooth werden als Fehler gemeldet (übersprungen).</p>}
        <p className="mt-2 text-[11px] text-muted">Leere Felder bleiben auf den Geräten unverändert.</p>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-muted">{selected.size} von {devices.length} Geräten gewählt</span>
          <div className="flex gap-3 text-xs">
            <button className="text-accent hover:underline" onClick={() => setSelected(new Set(devices.map((d) => d.id)))}>Alle</button>
            <button className="text-accent hover:underline" onClick={() => setSelected(new Set(devices.filter((d) => d.online).map((d) => d.id)))}>Nur online</button>
            <button className="text-muted hover:underline" onClick={() => setSelected(new Set())}>Keine</button>
          </div>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {devices.map((d) => (
            <label
              key={d.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${d.online ? 'border-line bg-panel2/60' : 'border-line/50 bg-panel2/30 opacity-60'}`}
            >
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <span className="min-w-0 flex-1 truncate">
                {d.name} <span className="text-xs text-muted">· {d.host} · {genLabel(d.gen)}</span>
              </span>
              {!d.online && <span className="text-xs text-danger">offline</span>}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {results && (
        <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel2/40 p-2 text-sm">
          <div className="mb-1 text-xs text-muted">
            {results.filter((r) => r.ok).length} erfolgreich · {results.filter((r) => !r.ok).length} fehlgeschlagen
          </div>
          {results.map((r) => (
            <div key={r.id} className={r.ok ? 'text-on' : 'text-danger'}>
              {r.ok ? '✓' : '✗'} {r.name}
              {r.error ? ` – ${r.error}` : ''}
            </div>
          ))}
        </div>
      )}

      <Button variant="primary" onClick={apply} disabled={applying || selected.size === 0} className="mt-4 w-full">
        {applying ? 'Wende an …' : `Auf ${selected.size} Gerät(e) anwenden`}
      </Button>
    </Modal>
  )
}
