# Shelly-Admin

Selbst-gehostete, schlanke Admin-Oberfläche für deine **Shelly-Geräte** – komplett
**lokal** und **cloudfrei**. Übersicht, Steuerung, Firmware-Updates und Geräte-Suche
für Gen1 *und* Gen2/3/4 in einem Docker-Stack.

> Schwesterprojekt zu [HomeDash](../homedash): gleiche Architektur (Node/Express +
> React/Vite/Tailwind, Deployment via Docker Compose hinter nginx).

## Funktionen

- **Erst-Setup-Assistent:** beim ersten Aufruf der WebGUI wird ein Administrator-Konto
  angelegt – optional direkt mit **Zwei-Faktor-Authentifizierung (TOTP)** inkl. QR-Code
  und Recovery-Codes.
- **Geräteübersicht:** Modell, Generation, IP/MAC, Firmware, **„Update verfügbar"**,
  Online-Status, Live-Leistung, Temperatur, WLAN-Signal, Uptime, Zuletzt-gesehen.
- **Steuerung (Voll-Admin):** Relais/Kanäle schalten, Neustart, Firmware-Update auslösen –
  pro Gerät, direkt aus der Karte. (Abschaltbar via `CONTROL_MODE`.)
- **Discovery:** ganzes `/24`-Subnetz parallel nach Shellys durchsuchen und gefundene
  Geräte per Klick übernehmen – oder manuell per IP/Hostname hinzufügen.
- **Geräte-Authentifizierung:** unterstützt Shellys mit aktivem Login (HTTP **Digest**
  für Gen2+, **Basic** für Gen1); Passwörter werden verschlüsselt gespeichert (AES-256-GCM).
- **Komfort:** Suche/Filter (Name, IP, Modell, Tag), Tags/Räume, „Nur mit Update"-Filter,
  Auto-Refresh.

## Architektur

```
Browser ──► Frontend (React + Vite + Tailwind)
               │  /api/*
               ▼
            Backend (Node/Express)  ──HTTP──►  Shelly-Geräte (Gen1 REST · Gen2+ RPC)
               │
               ▼
            JSON-Datei (/data)  ·  Admin-Konto, Geräteliste, Instanz-Secret
```

Das **Backend** spricht die Geräte serverseitig an (Anmeldedaten verlassen nie den
Browser), persistiert Konto und Geräteliste in einer einzigen JSON-Datei (keine native
Datenbank-Abhängigkeit) und schützt alle Aktionen per signiertem Session-Cookie.
Das **Frontend** ist eine statische SPA.

```
shelly-admin/
├─ backend/                Express-API + Shelly-Client
│  └─ src/
│     ├─ index.js          Routen (Setup, Login/MFA, Geräte, Steuerung, Discovery)
│     ├─ auth.js           Setup, Login, TOTP-MFA, Sessions
│     ├─ totp.js           TOTP (RFC 6238) – ohne externe Abhängigkeit
│     ├─ shelly.js         Gen1/Gen2-Client inkl. Digest/Basic-Auth + Steuerung
│     ├─ discovery.js      Subnetz-Scan
│     ├─ store.js          JSON-Persistenz (atomar)
│     ├─ crypto.js         scrypt-Passwort-Hash, AES-256-GCM, HMAC-Tokens
│     └─ config.js / util.js
├─ frontend/               React + Vite + Tailwind
│  └─ src/
│     ├─ App.tsx           Routing (Setup → Login → Dashboard) + Kopfzeile
│     ├─ api.ts            typisierter API-Client
│     └─ components/       Setup, Login, DeviceList, AddDevices, MfaEnroll, …
├─ docker-compose.yml
├─ .env  (NICHT eingecheckt)  ·  .env.example
└─ data/  (NICHT eingecheckt)  ·  JSON-Datenbank
```

## Voraussetzungen

- Node.js ≥ 20 (entwickelt mit Node 22)
- Shelly-Geräte im selben Netz, vom Server erreichbar
- Optional: Docker (für den Dauerbetrieb auf dem Home-Server / der NAS)

## Konfiguration (`.env`)

Im Projekt-Root liegt `.env` (Vorlage: `.env.example`). Alle Werte haben sinnvolle
Standardwerte; für den Start genügt das Kopieren der Vorlage:

```ini
CONTROL_MODE=full          # full | update | monitor
REFRESH_SECONDS=15
DEFAULT_SUBNET=            # z. B. 192.168.1.0/24 – Vorbelegung der Suche
AUTH_COOKIE_SECURE=false   # hinter HTTPS-Reverse-Proxy auf true
AUTH_SESSION_HOURS=168
```

Das **Admin-Konto** wird **nicht** in der `.env` gesetzt, sondern beim ersten WebGUI-Aufruf
im Browser angelegt.

## Lokal starten (Entwicklung)

```bash
npm run install:all        # einmalig
npm run dev                # Backend :3000 + Frontend :5174
```

Dann **http://localhost:5174** öffnen – der Assistent legt das Admin-Konto an.
Vite leitet `/api/*` automatisch an das Backend weiter.

## Dauerbetrieb mit Docker

```bash
cp .env.example .env       # ggf. anpassen
docker compose up -d --build
```

WebGUI danach unter **http://<server>:8090**. Details für die Synology-NAS:
siehe [DEPLOY-Synology.md](DEPLOY-Synology.md).

## API-Endpunkte (Auszug)

| Endpoint | Zweck |
| --- | --- |
| `GET /api/state` | Setup-/Login-Status (öffentlich) |
| `POST /api/setup` | Admin-Konto anlegen (nur beim Erst-Aufruf) |
| `POST /api/login` · `/login/mfa` | Anmeldung (+ TOTP-Schritt) |
| `GET /api/devices/status` | Geräteliste inkl. Live-Status |
| `POST /api/devices` · `PATCH/DELETE /api/devices/:id` | Gerät hinzufügen/ändern/entfernen |
| `POST /api/devices/:id/switch` | Relais/Kanal schalten |
| `POST /api/devices/:id/reboot` · `/update` · `/check-update` | Steuerung & Firmware |
| `POST /api/discover` | Subnetz nach Shellys durchsuchen |

## Sicherheit

- Passwort des Admins via **scrypt** gehasht; Sessions als **HMAC-signierte** Cookies
  (`httpOnly`, `sameSite=lax`).
- **TOTP-MFA** optional, mit verbrauchbaren Recovery-Codes.
- Geräte-Passwörter **AES-256-GCM-verschlüsselt** (Schlüssel aus dem Instanz-Secret).
- Login-**Rate-Limiting** gegen Brute-Force.
- Hinter einem HTTPS-Reverse-Proxy unbedingt `AUTH_COOKIE_SECURE=true` setzen.

## Hinweise & Grenzen

- Discovery nutzt einen **HTTP-Subnetz-Scan** (`/24`), nicht mDNS – das funktioniert
  zuverlässig auch aus einem Docker-Bridge-Container heraus.
- Es werden bewusst **keine Verlaufsdaten** gespeichert (nur Live-Werte). Für
  langfristige Energie-/Verbrauchshistorie ist [HomeDash](../homedash) gedacht.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
