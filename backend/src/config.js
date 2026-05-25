import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// .env liegt im Projekt-Root (eine Ebene ueber backend/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const bool = (v, def = false) =>
  v == null || v === '' ? def : String(v).toLowerCase() === 'true'

export const config = {
  port: Number(process.env.PORT ?? 3000),

  // Verzeichnis fuer die JSON-Datenbank (Admin-Konto, Geraeteliste, Instanz-Secret).
  // Im Container ein gemountetes Volume (siehe docker-compose.yml).
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '../../data'),

  // Steuerungsumfang: 'full' = schalten/reboot/update, 'update' = nur Updates,
  // 'monitor' = read-only. Standard: full (Voll-Admin).
  controlMode: (process.env.CONTROL_MODE || 'full').toLowerCase(),

  // Auto-Refresh-Intervall der Geraeteliste im Frontend (Sekunden).
  refreshSeconds: Math.max(3, Number(process.env.REFRESH_SECONDS ?? 15)),

  // Vorbelegung fuer den Subnetz-Scan, z. B. "192.168.1.0/24" (optional).
  defaultSubnet: process.env.DEFAULT_SUBNET || '',

  // Timeout je Geraete-HTTP-Anfrage (ms) und Parallelitaet beim Subnetz-Scan.
  deviceTimeoutMs: Math.max(300, Number(process.env.DEVICE_TIMEOUT_MS ?? 2500)),
  scanTimeoutMs: Math.max(200, Number(process.env.SCAN_TIMEOUT_MS ?? 900)),
  scanConcurrency: Math.max(4, Number(process.env.SCAN_CONCURRENCY ?? 48)),

  auth: {
    // Optionales explizites Cookie-Signier-Geheimnis. Leer -> Instanz-Secret aus dem Store.
    secret: process.env.AUTH_SECRET ?? '',
    // Hinter HTTPS-Reverse-Proxy UNBEDINGT auf true setzen.
    cookieSecure: bool(process.env.AUTH_COOKIE_SECURE, false),
    sessionHours: Math.max(1, Number(process.env.AUTH_SESSION_HOURS ?? 168)), // 7 Tage
  },
}

export const canControl = () => config.controlMode === 'full'
export const canUpdate = () => config.controlMode === 'full' || config.controlMode === 'update'
