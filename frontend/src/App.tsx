import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query'
import { fetchState, fetchDevicesStatus, logout, type AppState } from './api'
import { Setup } from './components/Setup'
import { Login } from './components/Login'
import { DeviceList } from './components/DeviceList'
import { AddDevices } from './components/AddDevices'
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
  const [account, setAccount] = useState(false)
  const [query, setQuery] = useState('')
  const [updatesOnly, setUpdatesOnly] = useState(false)

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
          </div>
        )}
      </header>

      <main className="px-4 py-4 pb-10 sm:px-6">
        {isError ? (
          <div className="rounded-2xl border border-danger/40 bg-danger/5 p-6 text-center text-danger">
            Verbindung zum Backend fehlgeschlagen.
          </div>
        ) : (
          <DeviceList devices={filtered} controlMode={state.controlMode} onChanged={refresh} />
        )}
      </main>

      {adding && (
        <AddDevices defaultSubnet={state.defaultSubnet} onChanged={refresh} onClose={() => setAdding(false)} />
      )}
      {account && <AccountDialog onClose={() => setAccount(false)} />}
    </div>
  )
}
