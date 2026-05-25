// Setzt das Admin-Konto zurueck, OHNE die Datenbank zu loeschen.
// Geraeteliste und Instanz-Secret (und damit verschluesselte Geraete-Passwoerter)
// bleiben erhalten. Beim naechsten WebGUI-Aufruf startet der Einrichtungs-Assistent.
//
// Lokal:  npm --prefix backend run reset:admin
// Docker: docker compose exec backend node src/reset-admin.js
import { getDb, persist } from './store.js'

const db = getDb()
const had = !!db.admin
db.admin = null
await persist()

if (had) {
  console.log('✓ Admin-Konto zurueckgesetzt. Geraeteliste & Instanz-Secret bleiben erhalten.')
  console.log('  Beim naechsten Aufruf der WebGUI startet der Einrichtungs-Assistent erneut.')
} else {
  console.log('Kein Admin-Konto vorhanden – nichts zu tun.')
}
process.exit(0)
