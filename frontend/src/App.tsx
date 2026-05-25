import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query'
import {
  fetchState,
  fetchDevicesStatus,
  logout,
  type AppState,
  type DeviceStatus,
  type ControlMode,
} from './api'
import { Setup } from './components/Setup'
import { Login } from './components/Login'
import { DeviceList } from './components/DeviceList'
import { AddDevices } from './components/AddDevices'
import { BulkServicesDialog } from './components/BulkServicesDialog'
import { AccountDialog } from './components/AccountDialog'
import { Button } from './components/ui'
import { fmtW } from './lib/format'

export default function App({ initialState }: { initialState: AppState }) {
  const [state, setState] = useState<AppState>(initialState)
  const qc = useQueryClient()

  const reload = async () => {
    const s = await fetchState().catch(() => state)
    setState(s)
    qc.invalidateQueries()
  }

  useEffect(() => {
    const handler = () => setState((s) => ({ ...s, authed: false }))
    window.addEventListener('sa:unauthorized', handler)
    return () => window.removeEventListener('sa:unauthorized', handler)
  }, [])

  if (state.needsSetup) return <Setup onDone={reload} />
  if (!state.authed) return <Login onSuccess={reload} />
  return <Dashboard state={state} onLogout={reload} />
}

function Dashboard({ state, onLogout }: { state: AppState; onLogout: () => void }) {
  const qc = useQueryClient()
  const fetching = useIsFetching()
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [account, setAccount] = useState(false)
  const [query, setQuery] = useState('')
  const [updatesOnly, setUpdatesOnly] = useState(false)
  const [groupByTag, setGroupByTag] = useState<boolean>(() => localStorage.getItem('sa:groupByTag') === '1')
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('sa:collapsed') || '[]')),
  )

  useEffect(() => {
    localStorage.setItem('sa:groupByTag', groupByTag ? '1' : '0')
  }, [groupByTag])

  const toggleCollapsed = (tag: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      localStorage.setItem('sa:collapsed', JSON.stringify([...next]))
      return next
    })

  const { data, isError } = useQuery({ queryKey: ['devices-status'], queryFn: fetchDevicesStatus })
  const devices = data?.devices ?? []

  const stats = useMemo(() => {
    const online = devices.filter((d) => d.online)
    return {
      total: devices.length,
      online: online.length,
      power: online.reduce((sum, d) => sum + (d.status?.power_w ?? 0), 0),
      updates: devices.filter((d) => d.status?.update.available).length,
    }
  }, [devices])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return devices.filter((d) => {
      if (updatesOnly && !d.status?.update.available) return false
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q) ||
        (d.model ?? '').toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [devices, query, updatesOnly])

  const groups = useMemo(() => groupDevicesByTag(filtered), [filtered])

  const refresh = () => qc.invalidateQueries({ queryKey: ['devices-status'] })

  async function doLogout() {
    await logout()
    qc.clear()
    onLogout()
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-update/20 text-xl">
              ⚡
            </div>
            <div>
              <h1 className="text-xl font-bold leading-none tracking-tight">Shelly-Admin</h1>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <span className={`inline-block h-2 w-2 rounded-full ${isError ? 'bg-danger' : 'bg-on pulse'}`} />
                {stats.online}/{stats.total} online · Σ {fmtW(stats.power)}
                {stats.updates > 0 && <span className="text-update"> · {stats.updates} Update(s)</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => setAdding(true)}>
              + Geräte
            </Button>
            {state.controlMode === 'full' && devices.length > 0 && (
              <button
                onClick={() => setBulk(true)}
                title="Dienste für mehrere Geräte konfigurieren"
                className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel/70 text-slate-300 transition hover:bg-panel2 hover:text-white"
              >
                🛠
              </button>
            )}
            <button
              onClick={refresh}
              title="Jetzt aktualisieren"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel/70 text-slate-300 transition hover:bg-panel2 hover:text-white"
            >
              <span className={`text-lg leading-none ${fetching ? 'inline-block animate-spin' : ''}`}>↻</span>
            </button>
            <button
              onClick={() => setAccount(true)}
              title="Konto & Sicherheit"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel/70 text-slate-300 transition hover:bg-panel2 hover:text-white"
            >
              ⚙
            </button>
            <button
              onClick={doLogout}
              title="Abmelden"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel/70 text-slate-300 transition hover:bg-panel2 hover:text-white"
            >
              ⏻
            </button>
          </div>
        </div>

        {devices.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen (Name, IP, Modell, Tag) …"
              className="w-full max-w-xs rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={() => setUpdatesOnly((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                updatesOnly ? 'border-update/40 bg-update/15 text-update' : 'border-line bg-panel2 text-muted hover:text-white'
              }`}
            >
              Nur mit Update {stats.updates > 0 ? `(${stats.updates})` : ''}
            </button>
            <button
              onClick={() => setGroupByTag((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                groupByTag ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line bg-panel2 text-muted hover:text-white'
              }`}
              title="Geräte nach (erstem) Tag gruppieren"
            >
              🏷 Nach Tag
            </button>
          </div>
        )}
      </header>

      <main className="px-4 py-4 pb-10 sm:px-6">
        {isError ? (
          <div className="rounded-2xl border border-danger/40 bg-danger/5 p-6 text-center text-danger">
            Verbindung zum Backend fehlgeschlagen.
          </div>
        ) : groupByTag ? (
          <div className="space-y-5">
            {groups.map((g) => (
              <GroupSection
                key={g.tag}
                group={g}
                controlMode={state.controlMode}
                onChanged={refresh}
                collapsed={collapsed.has(g.tag)}
                onToggle={() => toggleCollapsed(g.tag)}
              />
            ))}
          </div>
        ) : (
          <DeviceList devices={filtered} controlMode={state.controlMode} onChanged={refresh} />
        )}
      </main>

      {adding && (
        <AddDevices defaultSubnet={state.defaultSubnet} onChanged={refresh} onClose={() => setAdding(false)} />
      )}
      {bulk && <BulkServicesDialog devices={devices} onClose={() => setBulk(false)} />}
      {account && <AccountDialog onClose={() => setAccount(false)} />}
    </div>
  )
}

type Group = { tag: string; devices: DeviceStatus[] }
const NO_TAG = '— Ohne Tag —'

/** Geräte nach ihrem ersten (primären) Tag gruppieren; ohne Tag ans Ende. */
function groupDevicesByTag(devices: DeviceStatus[]): Group[] {
  const map = new Map<string, DeviceStatus[]>()
  for (const d of devices) {
    const tag = d.tags?.[0]?.trim() || NO_TAG
    if (!map.has(tag)) map.set(tag, [])
    map.get(tag)!.push(d)
  }
  return [...map.entries()]
    .map(([tag, list]) => ({ tag, devices: list }))
    .sort((a, b) => {
      if ((a.tag === NO_TAG) !== (b.tag === NO_TAG)) return a.tag === NO_TAG ? 1 : -1
      return a.tag.localeCompare(b.tag, 'de')
    })
}

function GroupSection({
  group,
  controlMode,
  onChanged,
  collapsed,
  onToggle,
}: {
  group: Group
  controlMode: ControlMode
  onChanged: () => void
  collapsed: boolean
  onToggle: () => void
}) {
  const online = group.devices.filter((d) => d.online).length
  const power = group.devices.reduce((sum, d) => sum + (d.status?.power_w ?? 0), 0)
  return (
    <section>
      <button
        onClick={onToggle}
        className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-panel2/40"
      >
        <span className="text-muted">{collapsed ? '▸' : '▾'}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide">{group.tag}</h2>
        <span className="text-xs text-muted">
          · {online}/{group.devices.length} online · Σ {fmtW(power)}
        </span>
      </button>
      {!collapsed && <DeviceList devices={group.devices} controlMode={controlMode} onChanged={onChanged} />}
    </section>
  )
}
