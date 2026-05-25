import { useState } from 'react'
import {
  setSwitch,
  rebootDevice,
  checkUpdate,
  installUpdate,
  deleteDevice,
  patchDevice,
  type DeviceStatus,
  type ControlMode,
} from '../api'
import { Modal, Button, Field, inputClass, ErrorText } from './ui'
import { fmtW, fmtTemp, fmtVolt, fmtUptime, fmtRelative, rssiBars, genLabel } from '../lib/format'

export function DeviceList({
  devices,
  controlMode,
  onChanged,
}: {
  devices: DeviceStatus[]
  controlMode: ControlMode
  onChanged: () => void
}) {
  if (devices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/40 p-10 text-center text-muted">
        Noch keine Geräte. Füge eines manuell hinzu oder durchsuche dein Netzwerk.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {devices.map((d) => (
        <DeviceCard key={d.id} d={d} controlMode={controlMode} onChanged={onChanged} />
      ))}
    </div>
  )
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-on pulse' : 'bg-danger'}`}
      title={online ? 'Online' : 'Offline'}
    />
  )
}

function RssiBars({ rssi }: { rssi: number | null }) {
  const bars = rssiBars(rssi)
  return (
    <span className="inline-flex items-end gap-0.5" title={rssi != null ? `${rssi} dBm` : 'kein Signal'}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-sm ${i <= bars ? 'bg-accent' : 'bg-line'}`}
          style={{ height: `${i * 3 + 2}px` }}
        />
      ))}
    </span>
  )
}

function Metric({ icon, value, title }: { icon: string; value: string; title: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted" title={title}>
      <span>{icon}</span>
      <span className="tabular-nums text-slate-200">{value}</span>
    </span>
  )
}

function DeviceCard({
  d,
  controlMode,
  onChanged,
}: {
  d: DeviceStatus
  controlMode: ControlMode
  onChanged: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const canControl = controlMode === 'full'
  const canUpdate = controlMode !== 'monitor'
  const s = d.status

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusy(null)
      setMenu(false)
    }
  }

  return (
    <div className={`relative rounded-2xl border bg-panel/75 p-4 shadow-lg shadow-black/20 ${d.online ? 'border-line' : 'border-danger/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot online={d.online} />
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">{d.name}</div>
            <div className="truncate text-xs text-muted">
              {s?.ip || d.host} · {genLabel(d.gen)} · {s?.model || d.model || '?'}
            </div>
          </div>
        </div>

        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} className="rounded-md px-1.5 text-muted hover:text-white" title="Aktionen">
            ⋮
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-panel2 text-sm shadow-xl">
                <button className="block w-full px-3 py-2 text-left hover:bg-line" onClick={() => { setEditing(true); setMenu(false) }}>
                  ✏️ Bearbeiten
                </button>
                {canControl && (
                  <button
                    className="block w-full px-3 py-2 text-left hover:bg-line disabled:opacity-50"
                    disabled={busy === 'reboot' || !d.online}
                    onClick={() => run('reboot', () => rebootDevice(d.id))}
                  >
                    🔄 Neustart
                  </button>
                )}
                {canUpdate && (
                  <button
                    className="block w-full px-3 py-2 text-left hover:bg-line disabled:opacity-50"
                    disabled={busy === 'check' || !d.online}
                    onClick={() => run('check', () => checkUpdate(d.id))}
                  >
                    🔍 Auf Update prüfen
                  </button>
                )}
                <button
                  className="block w-full px-3 py-2 text-left text-danger hover:bg-line"
                  onClick={() => {
                    if (confirm(`„${d.name}“ wirklich entfernen?`)) run('del', () => deleteDevice(d.id))
                  }}
                >
                  🗑 Entfernen
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Live-Werte */}
      {d.online && s ? (
        <>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted">Leistung</div>
              <div className="text-2xl font-bold tabular-nums text-accent">{fmtW(s.power_w)}</div>
            </div>
            {s.update.available && (
              <span className="rounded-full border border-update/40 bg-update/15 px-2 py-1 text-xs font-medium text-update">
                Update {s.update.newVersion ? `→ ${s.update.newVersion}` : 'verfügbar'}
              </span>
            )}
          </div>

          {/* Schalter */}
          {s.switches.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {s.switches.map((sw) => (
                <button
                  key={sw.id}
                  disabled={!canControl || busy === `sw${sw.id}`}
                  onClick={() => run(`sw${sw.id}`, () => setSwitch(d.id, sw.id, !sw.on))}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${
                    sw.on
                      ? 'border-on/40 bg-on/15 text-on'
                      : 'border-line bg-panel2 text-muted'
                  } ${canControl ? 'hover:brightness-125' : 'opacity-90'}`}
                  title={canControl ? 'Umschalten' : 'Nur-Lese-Modus'}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${sw.on ? 'bg-on' : 'bg-off'}`} />
                  {s.switches.length > 1 ? `Kanal ${sw.id + 1}` : 'Relais'} · {sw.on ? 'AN' : 'AUS'}
                </button>
              ))}
            </div>
          )}

          {/* Kennzahlen */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {s.temperature_c != null && <Metric icon="🌡" value={fmtTemp(s.temperature_c)} title="Temperatur" />}
            {s.voltage != null && <Metric icon="⚡" value={fmtVolt(s.voltage)} title="Spannung" />}
            <span className="inline-flex items-center gap-1.5 text-muted" title="WLAN-Signal">
              <RssiBars rssi={s.rssi} />
            </span>
            <Metric icon="⏱" value={fmtUptime(s.uptime_s)} title="Uptime" />
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          Offline{d.error ? ` – ${d.error}` : ''}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-[11px] text-muted">
        <span>FW {s?.fw || d.fw || '?'}</span>
        {s?.update.available && canUpdate && (
          <button
            className="rounded-md border border-update/40 bg-update/10 px-2 py-0.5 text-update hover:bg-update/20 disabled:opacity-50"
            disabled={busy === 'update'}
            onClick={() => run('update', () => installUpdate(d.id))}
          >
            {busy === 'update' ? 'Starte …' : 'Jetzt aktualisieren'}
          </button>
        )}
        <span title={d.lastSeen ? new Date(d.lastSeen).toLocaleString('de-DE') : ''}>
          {d.online ? 'live' : `zuletzt ${fmtRelative(d.lastSeen)}`}
        </span>
      </div>

      {editing && <EditDialog d={d} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </div>
  )
}

function EditDialog({ d, onClose, onSaved }: { d: DeviceStatus; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(d.name)
  const [tags, setTags] = useState((d.tags ?? []).join(', '))
  const [username, setUsername] = useState(d.auth?.username ?? '')
  const [password, setPassword] = useState('')
  const [removeAuth, setRemoveAuth] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError('')
    try {
      const patch: { name?: string; tags?: string[]; username?: string; password?: string } = {
        name: name.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }
      if (removeAuth) patch.password = ''
      else if (password) {
        patch.password = password
        patch.username = username || 'admin'
      } else if (username && d.auth?.enabled) patch.username = username
      await patchDevice(d.id, patch)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
      setBusy(false)
    }
  }

  return (
    <Modal title="Gerät bearbeiten" onClose={onClose}>
      <Field label="Anzeigename">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Tags / Raum (Komma-getrennt)">
        <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="z. B. Küche, Licht" />
      </Field>

      <div className="mt-2 rounded-lg border border-line bg-panel2/40 p-3">
        <div className="mb-2 text-xs font-medium text-muted">Geräte-Zugangsdaten</div>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Benutzer (admin)"
            disabled={removeAuth}
            autoComplete="off"
          />
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={d.auth?.hasPassword ? 'unverändert' : 'Passwort'}
            disabled={removeAuth}
            autoComplete="off"
          />
        </div>
        {d.auth?.enabled && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={removeAuth} onChange={(e) => setRemoveAuth(e.target.checked)} />
            Zugangsdaten entfernen
          </label>
        )}
      </div>

      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save} disabled={busy} className="flex-1">
          {busy ? 'Speichere …' : 'Speichern'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
      </div>
    </Modal>
  )
}
