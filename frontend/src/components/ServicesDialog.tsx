import { useEffect, useState, type ReactNode } from 'react'
import { getServices, setService, type DeviceServices, type ServiceState } from '../api'
import { Modal, Button, inputClass, ErrorText } from './ui'

type SaveFn = (config: Record<string, unknown>) => Promise<unknown>
const restartMsg = (r: unknown) =>
  r && typeof r === 'object' && (r as { restart_required?: boolean }).restart_required
    ? 'Gespeichert – Gerät startet neu.'
    : 'Gespeichert.'

/** Konfiguration der Geräte-Dienste: MQTT, Bluetooth, Access Point, Cloud. */
export function ServicesDialog({
  deviceId,
  deviceName,
  canControl,
  onClose,
}: {
  deviceId: string
  deviceName: string
  canControl: boolean
  onClose: () => void
}) {
  const [data, setData] = useState<DeviceServices | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getServices(deviceId)
      .then((r) => {
        setData(r.services)
        setErr('')
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen'))
      .finally(() => setLoading(false))
  }, [deviceId])

  const save = (service: 'mqtt' | 'ble' | 'ap' | 'cloud'): SaveFn => (config) =>
    setService(deviceId, service, config).then((r) => r.result)

  return (
    <Modal title={`Dienste – ${deviceName}`} onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-muted">Lade Konfiguration …</p>
      ) : err ? (
        <ErrorText>{err}</ErrorText>
      ) : data ? (
        <div className="space-y-3">
          {!canControl && (
            <p className="rounded-lg border border-line bg-panel2/50 px-3 py-2 text-xs text-muted">
              Nur-Lese-Modus (CONTROL_MODE) – Änderungen sind deaktiviert.
            </p>
          )}
          <MqttSection s={data.mqtt} canControl={canControl} save={save('mqtt')} />
          <BleSection s={data.ble} canControl={canControl} save={save('ble')} />
          <ApSection s={data.ap} canControl={canControl} save={save('ap')} />
          <CloudSection s={data.cloud} canControl={canControl} save={save('cloud')} />
        </div>
      ) : null}
    </Modal>
  )
}

function SectionFrame({
  icon,
  title,
  supported,
  enable,
  onEnable,
  canControl,
  busy,
  msg,
  error,
  onSave,
  hint,
  children,
}: {
  icon: string
  title: string
  supported: boolean
  enable: boolean
  onEnable: (v: boolean) => void
  canControl: boolean
  busy: boolean
  msg: string
  error: string
  onSave: () => void
  hint?: string
  children?: ReactNode
}) {
  if (!supported) {
    return (
      <div className="rounded-xl border border-line bg-panel2/30 p-3 opacity-60">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon} {title}
        </div>
        <p className="mt-1 text-xs text-muted">Von diesem Gerät nicht unterstützt.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-line bg-panel2/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon} {title}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={enable} disabled={!canControl} onChange={(e) => onEnable(e.target.checked)} />
          aktiviert
        </label>
      </div>
      {enable && children}
      {hint && <p className="mt-2 text-[11px] text-muted">{hint}</p>}
      <div className="mt-2 flex items-center gap-3">
        <Button variant="primary" onClick={onSave} disabled={!canControl || busy}>
          {busy ? 'Speichere …' : 'Speichern'}
        </Button>
        {msg && <span className="text-xs text-on">{msg}</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  )
}

function useSaver(save: SaveFn) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const run = async (config: Record<string, unknown>, after?: () => void) => {
    setBusy(true)
    setMsg('')
    setError('')
    try {
      const r = await save(config)
      setMsg(restartMsg(r))
      after?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, error, run }
}

function MqttSection({ s, canControl, save }: { s: ServiceState; canControl: boolean; save: SaveFn }) {
  const [enable, setEnable] = useState(!!s.enable)
  const [server, setServer] = useState(s.server || '')
  const [user, setUser] = useState(s.user || '')
  const [password, setPassword] = useState('')
  const [prefix, setPrefix] = useState(s.prefix || '')
  const { busy, msg, error, run } = useSaver(save)
  return (
    <SectionFrame
      icon="📡"
      title="MQTT"
      supported={s.supported}
      enable={enable}
      onEnable={setEnable}
      canControl={canControl}
      busy={busy}
      msg={msg}
      error={error}
      onSave={() => run({ enable, server, user, prefix, password: password || undefined }, () => setPassword(''))}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputClass} value={server} onChange={(e) => setServer(e.target.value)} placeholder="Server (host:1883)" disabled={!canControl} />
        <input className={inputClass} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Topic-Prefix" disabled={!canControl} autoComplete="off" />
        <input className={inputClass} value={user} onChange={(e) => setUser(e.target.value)} placeholder="Benutzer (optional)" disabled={!canControl} autoComplete="off" />
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={s.enable ? 'Passwort (unverändert lassen)' : 'Passwort (optional)'}
          disabled={!canControl}
          autoComplete="off"
        />
      </div>
    </SectionFrame>
  )
}

function BleSection({ s, canControl, save }: { s: ServiceState; canControl: boolean; save: SaveFn }) {
  const [enable, setEnable] = useState(!!s.enable)
  const [rpcEnable, setRpcEnable] = useState(!!s.rpcEnable)
  const { busy, msg, error, run } = useSaver(save)
  return (
    <SectionFrame
      icon="🔵"
      title="Bluetooth"
      supported={s.supported}
      enable={enable}
      onEnable={setEnable}
      canControl={canControl}
      busy={busy}
      msg={msg}
      error={error}
      onSave={() => run({ enable, rpcEnable })}
    >
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={rpcEnable} disabled={!canControl} onChange={(e) => setRpcEnable(e.target.checked)} />
        Bluetooth-RPC (Gerätesteuerung via BLE)
      </label>
    </SectionFrame>
  )
}

function ApSection({ s, canControl, save }: { s: ServiceState; canControl: boolean; save: SaveFn }) {
  const [enable, setEnable] = useState(!!s.enable)
  const [ssid, setSsid] = useState(s.ssid || '')
  const [password, setPassword] = useState('')
  const { busy, msg, error, run } = useSaver(save)
  return (
    <SectionFrame
      icon="📶"
      title="Access Point (eigener Hotspot)"
      supported={s.supported}
      enable={enable}
      onEnable={setEnable}
      canControl={canControl}
      busy={busy}
      msg={msg}
      error={error}
      hint="Der Access Point ist der Notfall-Hotspot des Geräts. Bei aktiver WLAN-Verbindung kann er bedenkenlos deaktiviert werden."
      onSave={() => run({ enable, ssid, password: password || undefined }, () => setPassword(''))}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputClass} value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="SSID" disabled={!canControl} />
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={s.isOpen ? 'Passwort (leer = offen)' : 'Passwort (unverändert lassen)'}
          disabled={!canControl}
          autoComplete="off"
        />
      </div>
    </SectionFrame>
  )
}

function CloudSection({ s, canControl, save }: { s: ServiceState; canControl: boolean; save: SaveFn }) {
  const [enable, setEnable] = useState(!!s.enable)
  const { busy, msg, error, run } = useSaver(save)
  return (
    <SectionFrame
      icon="☁️"
      title="Shelly Cloud"
      supported={s.supported}
      enable={enable}
      onEnable={setEnable}
      canControl={canControl}
      busy={busy}
      msg={msg}
      error={error}
      hint={s.connected !== undefined ? (s.connected ? 'Status: verbunden.' : 'Status: nicht verbunden.') : undefined}
      onSave={() => run({ enable })}
    >
      <p className="text-xs text-muted">Verbindung zur Shelly-Cloud (Fernzugriff über die Shelly-App).</p>
    </SectionFrame>
  )
}
