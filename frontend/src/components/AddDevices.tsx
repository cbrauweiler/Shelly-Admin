import { useState } from 'react'
import { addDevice, discover, importDevices, type Discovered } from '../api'
import { Modal, Button, Field, inputClass, ErrorText } from './ui'
import { genLabel } from '../lib/format'

export function AddDevices({
  defaultSubnet,
  onChanged,
  onClose,
}: {
  defaultSubnet: string
  onChanged: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'manual' | 'scan'>('manual')

  return (
    <Modal title="Geräte hinzufügen" onClose={onClose} wide>
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-panel2/50 p-1 text-sm">
        <button
          onClick={() => setTab('manual')}
          className={`flex-1 rounded-md px-3 py-1.5 transition ${tab === 'manual' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}
        >
          Manuell (IP)
        </button>
        <button
          onClick={() => setTab('scan')}
          className={`flex-1 rounded-md px-3 py-1.5 transition ${tab === 'scan' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}
        >
          Netzwerk durchsuchen
        </button>
      </div>

      {tab === 'manual' ? (
        <ManualAdd onChanged={onChanged} onClose={onClose} />
      ) : (
        <ScanAdd defaultSubnet={defaultSubnet} onChanged={onChanged} />
      )}
    </Modal>
  )
}

function ManualAdd({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const [host, setHost] = useState('')
  const [name, setName] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await addDevice(host, name || undefined, username || undefined, password || undefined)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hinzufügen fehlgeschlagen')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="IP-Adresse oder Hostname">
        <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" autoFocus />
      </Field>
      <Field label="Anzeigename (optional)">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Waschmaschine" />
      </Field>

      <button type="button" onClick={() => setShowAuth((v) => !v)} className="mb-2 text-xs text-muted hover:text-white">
        {showAuth ? '▾' : '▸'} Geräte-Zugangsdaten (falls Auth aktiv)
      </button>
      {showAuth && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Benutzer (admin)" autoComplete="off" />
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort" autoComplete="off" />
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" disabled={busy || !host.trim()} className="mt-3 w-full">
        {busy ? 'Prüfe Gerät …' : 'Hinzufügen'}
      </Button>
    </form>
  )
}

function ScanAdd({ defaultSubnet, onChanged }: { defaultSubnet: string; onChanged: () => void }) {
  const [subnet, setSubnet] = useState(defaultSubnet)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ scanned: number; found: Discovered[] } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState('')

  async function runScan(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    setImported('')
    try {
      const r = await discover(subnet.trim())
      setResult(r)
      setSelected(new Set(r.found.filter((d) => !d.alreadyAdded).map((d) => d.host)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function toggle(host: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }

  async function doImport() {
    setImporting(true)
    setError('')
    try {
      const res = await importDevices([...selected].map((host) => ({ host })))
      setImported(`${res.added.length} Gerät(e) hinzugefügt.`)
      onChanged()
      // Übernommene aus der Liste entfernen
      setResult((prev) =>
        prev ? { ...prev, found: prev.found.map((d) => (selected.has(d.host) ? { ...d, alreadyAdded: true } : d)) } : prev,
      )
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <form onSubmit={runScan} className="flex gap-2">
        <input
          className={inputClass}
          value={subnet}
          onChange={(e) => setSubnet(e.target.value)}
          placeholder="192.168.1.0/24"
          autoFocus
        />
        <Button type="submit" variant="primary" disabled={busy || !subnet.trim()}>
          {busy ? 'Scanne …' : 'Suchen'}
        </Button>
      </form>
      <p className="mt-1 text-xs text-muted">Durchsucht ein /24-Subnetz (.1–.254) nach Shelly-Geräten.</p>

      <ErrorText>{error}</ErrorText>
      {imported && <p className="mt-2 text-sm text-on">{imported}</p>}

      {result && (
        <div className="mt-3">
          <div className="mb-2 text-xs text-muted">
            {result.scanned} Adressen geprüft · {result.found.length} Shelly gefunden
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {result.found.map((d) => (
              <label
                key={d.host}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  d.alreadyAdded ? 'border-line/50 bg-panel2/30 opacity-60' : 'border-line bg-panel2/60'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={d.alreadyAdded}
                  checked={selected.has(d.host)}
                  onChange={() => toggle(d.host)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.name || d.model || 'Shelly'}</div>
                  <div className="text-xs text-muted">
                    {d.host} · {genLabel(d.gen)} · {d.model ?? '?'}
                    {d.authEnabled && ' · 🔒 Auth'}
                  </div>
                </div>
                {d.alreadyAdded && <span className="text-xs text-muted">bereits vorhanden</span>}
              </label>
            ))}
            {result.found.length === 0 && <p className="text-sm text-muted">Keine Geräte gefunden.</p>}
          </div>

          {result.found.some((d) => !d.alreadyAdded) && (
            <Button variant="primary" onClick={doImport} disabled={importing || selected.size === 0} className="mt-3 w-full">
              {importing ? 'Übernehme …' : `${selected.size} ausgewählte übernehmen`}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
