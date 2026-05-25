import { config } from './config.js'
import { expandSubnet, pool } from './util.js'
import { probe } from './shelly.js'

// Geraete-Erkennung per Subnetz-Scan: jede Host-Adresse mit kurzem Timeout an
// /shelly anklopfen. Funktioniert unabhaengig von mDNS (das ueber die Docker-
// Bridge ohnehin unzuverlaessig ist) und findet Gen1- wie Gen2-Geraete.

/**
 * Scant ein /24-Subnetz nach Shelly-Geraeten.
 * @param subnet z. B. "192.168.1.0/24" oder "192.168.1"
 * @param knownHosts Set bereits hinzugefuegter Hosts (zum Markieren)
 * @returns { scanned, found: [{ host, gen, model, mac, fw, name, authEnabled, alreadyAdded }] }
 */
export async function scanSubnet(subnet, knownHosts = new Set()) {
  const hosts = expandSubnet(subnet)
  const results = await pool(hosts, config.scanConcurrency, async (host) => {
    try {
      const info = await probe(host, null, config.scanTimeoutMs)
      return { host, ...info, alreadyAdded: knownHosts.has(host) }
    } catch {
      return null // nicht erreichbar / kein Shelly
    }
  })
  const found = results.filter((r) => r && r.reachable)
  // Geraete mit aktiver Auth antworten auf /shelly trotzdem (auth liefert Metadaten frei),
  // werden also ebenfalls gefunden.
  return { scanned: hosts.length, found }
}
