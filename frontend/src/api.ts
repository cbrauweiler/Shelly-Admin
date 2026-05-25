export class UnauthorizedError extends Error {}

// --- Low-Level ---------------------------------------------------------------

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (res.status === 401) throw new UnauthorizedError('unauthorized')
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** POST/PATCH/DELETE für geschützte Aktionen: 401 -> globales Session-Handling. */
async function apiSend<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new UnauthorizedError('unauthorized')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data as T
}

/** POST für Auth-Flows: 401 = falsche Zugangsdaten (kein Session-Verlust). */
async function authPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data as T
}

// --- Typen -------------------------------------------------------------------

export type ControlMode = 'full' | 'update' | 'monitor'

export type AppState = {
  needsSetup: boolean
  authed: boolean
  controlMode: ControlMode
  refreshSeconds: number
  defaultSubnet: string
}

export type MfaProvisioning = {
  secret: string
  otpauthUrl: string
  recoveryCodes: string[]
}

export type DeviceAuth = { enabled: boolean; username: string; hasPassword: boolean } | null

export type Device = {
  id: string
  name: string
  host: string
  gen: number
  model: string | null
  mac: string | null
  fw: string | null
  tags: string[]
  addedAt: string
  lastSeen: string | null
  auth: DeviceAuth
}

export type SwitchType = 'switch' | 'light' | 'rgb' | 'rgbw' | 'cct' | 'white' | 'relay'
export type SwitchState = { id: number; on: boolean; type?: SwitchType }

export type LiveStatus = {
  online: boolean
  power_w: number | null
  switches: SwitchState[]
  temperature_c: number | null
  rssi: number | null
  ip: string | null
  uptime_s: number | null
  fw: string | null
  update: { available: boolean; newVersion: string | null; beta: string | null }
  voltage: number | null
  model?: string | null
}

export type DeviceStatus = Device & {
  online: boolean
  status: LiveStatus | null
  error?: string
}

export type Discovered = {
  host: string
  reachable: boolean
  gen: number
  model: string | null
  mac: string | null
  fw: string | null
  name: string | null
  authEnabled: boolean
  alreadyAdded: boolean
}

// --- Endpunkte ---------------------------------------------------------------

export const fetchState = () => apiGet<AppState>('/api/state')

export const setup = (username: string, password: string, enableMfa: boolean) =>
  authPost<{ ok: boolean; mfa: MfaProvisioning | null }>('/api/setup', { username, password, enableMfa })

export const login = (username: string, password: string) =>
  authPost<{ ok: boolean; mfaRequired: boolean }>('/api/login', { username, password })

export const loginMfa = (code: string) => authPost<{ ok: boolean }>('/api/login/mfa', { code })

export const logout = () => fetch('/api/logout', { method: 'POST' })

export const account = () => apiGet<{ username: string; mfaEnabled: boolean }>('/api/account')
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiSend<{ ok: boolean }>('/api/account/password', 'POST', { currentPassword, newPassword })
export const beginMfa = () => apiSend<MfaProvisioning>('/api/mfa/begin', 'POST')
export const enableMfa = (code: string) => apiSend<{ ok: boolean }>('/api/mfa/enable', 'POST', { code })
export const disableMfa = (password: string) =>
  apiSend<{ ok: boolean }>('/api/mfa/disable', 'POST', { password })

export const fetchDevicesStatus = () =>
  apiGet<{ devices: DeviceStatus[] }>('/api/devices/status')

export const addDevice = (host: string, name?: string, username?: string, password?: string) =>
  apiSend<Device>('/api/devices', 'POST', { host, name, username, password })

export const patchDevice = (
  id: string,
  patch: { name?: string; tags?: string[]; username?: string; password?: string; pushName?: boolean },
) => apiSend<Device & { pushError?: string | null }>(`/api/devices/${id}`, 'PATCH', patch)

export const deleteDevice = (id: string) => apiSend<{ ok: boolean }>(`/api/devices/${id}`, 'DELETE')

export const setSwitch = (id: string, sw: number, on: boolean, type?: SwitchType) =>
  apiSend<{ ok: boolean }>(`/api/devices/${id}/switch`, 'POST', { id: sw, on, type })

export const rebootDevice = (id: string) => apiSend<{ ok: boolean }>(`/api/devices/${id}/reboot`, 'POST')
export const checkUpdate = (id: string) => apiSend<{ ok: boolean }>(`/api/devices/${id}/check-update`, 'POST')
export const installUpdate = (id: string, stage: 'stable' | 'beta' = 'stable') =>
  apiSend<{ ok: boolean }>(`/api/devices/${id}/update`, 'POST', { stage })

export type ServiceName = 'mqtt' | 'ble' | 'ap' | 'cloud'

export type ServiceState = {
  supported: boolean
  enable?: boolean
  server?: string
  user?: string
  clientId?: string
  prefix?: string
  rpcEnable?: boolean
  ssid?: string
  isOpen?: boolean
  connected?: boolean
}

export type BulkResult = { id: string; name: string; ok: boolean; error?: string }

export type DeviceServices = Record<ServiceName, ServiceState>

export const getServices = (id: string) =>
  apiGet<{ services: DeviceServices }>(`/api/devices/${id}/services`)

export const setService = (id: string, service: ServiceName, config: Record<string, unknown>) =>
  apiSend<{ ok: boolean; result: unknown }>(`/api/devices/${id}/services`, 'POST', { service, config })

export const bulkSetService = (deviceIds: string[], service: ServiceName, config: Record<string, unknown>) =>
  apiSend<{ results: BulkResult[] }>('/api/services/bulk', 'POST', { deviceIds, service, config })

export const discover = (subnet: string) =>
  apiSend<{ scanned: number; found: Discovered[] }>('/api/discover', 'POST', { subnet })

export const importDevices = (devices: { host: string; name?: string }[]) =>
  apiSend<{ added: Device[]; skipped: string[] }>('/api/devices/import', 'POST', { devices })
