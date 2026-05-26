# GitOps-Deployment: lokales Gitea + Portainer (Synology DS920+)

Ziel-Workflow (identisch zu HomeDash):

```
lokal editieren (z:\Projekte\Shelly-Admin)
   -> npm run dev  (DEV begutachten)
   -> git push gitea main   (zu Gitea auf dem NAS)
        -> Portainer erkennt die Aenderung (Polling oder Webhook)
             -> baut die Images neu und ersetzt die Container
                  -> http://192.168.2.10:8083
```

Alles bleibt im LAN. Es gibt **keine** Pflicht-Secrets im Repo: Das Admin-Konto wird
erst beim ersten WebGUI-Aufruf angelegt, das Instanz-Secret liegt im gemounteten
`./data`-Volume. Optionale Tuning-Werte (`CONTROL_MODE`, `DEFAULT_SUBNET`, …) kommen
aus den Stack-Environment-Variablen von Portainer (und lokal aus `.env`).

Ist-Umgebung: NAS-IP `192.168.2.10`, Host `sfc.ufp.internal`, Docker-Root `/volume1/docker`.
**Gitea** laeuft aus dem **Synology-Paketzentrum** unter `http://sfcatufp.diskstation.me:8418`
(Benutzer `christian`). Repo: `christian/shelly-admin`.

---

## Schritt 1 — Gitea  ✅ (erledigt)

Dieselbe Gitea-Instanz wie bei HomeDash (Paketzentrum, Port **8418**). Eine
Docker-Variante ist nicht noetig.

---

## Schritt 2 — Repo + Zugriffstoken

Repo `christian/shelly-admin` ist in Gitea angelegt.

> **Empfehlung:** Fuer Portainer einen **separaten, read-only** Token vergeben
> (Gitea -> *Settings* -> *Applications* -> Scope nur `read:repository`). So muss
> in Portainer kein Allzweck-/Schreib-Token hinterlegt werden.

Clone-URL: `http://sfcatufp.diskstation.me:8418/christian/shelly-admin.git`
(LAN-Alternative: `http://192.168.2.10:8418/christian/shelly-admin.git`)

---

## Schritt 3 — Shelly-Admin zu Gitea pushen  ✅ (erledigt)

Gitea ist als zweites Remote `gitea` eingerichtet; `origin` zeigt weiterhin auf
GitHub (oeffentlicher Mirror). Kuenftig:

```powershell
cd z:\Projekte\Shelly-Admin
git add -A; git commit -m "..."
git push          # -> GitHub (origin)
git push gitea    # -> Gitea auf dem NAS  (loest das Deployment aus)
```

> **Bequemer (optional):** Beide Ziele mit einem Befehl bedienen, indem man Gitea
> als zusaetzliche Push-URL von `origin` hinterlegt:
> ```powershell
> git remote set-url --add --push origin https://github.com/cbrauweiler/Shelly-Admin.git
> git remote set-url --add --push origin http://sfcatufp.diskstation.me:8418/christian/shelly-admin.git
> ```
> Danach pusht `git push` zu **beiden** Repos.

`.env`, `node_modules/`, `dist/` und `data/` bleiben durch `.gitignore` aussen vor.

---

## Schritt 4 — Shelly-Admin-Stack in Portainer AUS dem Git-Repo anlegen

Portainer -> *Stacks* -> *Add stack* -> Name `shelly-admin` -> Build method
**Repository**:

| Feld | Wert |
|------|------|
| Repository URL | `http://sfcatufp.diskstation.me:8418/christian/shelly-admin.git` (oder LAN: `http://192.168.2.10:8418/christian/shelly-admin.git`) |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | **an** -> Username = `christian`, Password = **read-only Token** (siehe Schritt 2) |

**Environment variables** (Abschnitt weiter unten im Formular) — fuellen die
`${VAR}` in der `docker-compose.yml`. **Alle optional**, da jeder Wert einen
Default hat. Sinnvoll zu setzen:

```
DEFAULT_SUBNET      = 192.168.1.0/24    # Vorbelegung des Scan-Felds (an dein Heimnetz anpassen)
CONTROL_MODE        = full              # full | update | monitor
REFRESH_SECONDS     = 15
AUTH_COOKIE_SECURE  = false             # hinter HTTPS-Reverse-Proxy auf true setzen
AUTH_SESSION_HOURS  = 168
# AUTH_SECRET       =                   # leer lassen = wird automatisch erzeugt & in data/ gespeichert
# DEVICE_TIMEOUT_MS / SCAN_TIMEOUT_MS / SCAN_CONCURRENCY  nur bei Bedarf
```

> Das **Admin-Konto** wird NICHT hier gesetzt, sondern beim ersten Aufruf der WebGUI
> im Einrichtungs-Assistenten angelegt.

**GitOps updates** aktivieren (Schalter im selben Formular):
- **Mechanism: Polling** — Intervall z. B. `5m`. Portainer prueft Gitea regelmaessig
  und deployt neu, sobald sich der Commit aendert. Einfachster Weg, kein Webhook noetig.
- *oder* **Webhook** — Portainer erzeugt eine Webhook-URL; die traegst du in Gitea ein
  (Schritt 6) -> Redeploy passiert sofort beim Push statt erst beim naechsten Polling.

Dann **Deploy the stack**. Der erste Build dauert auf der NAS-CPU ein paar Minuten
(Backend + Frontend/Vite).

---

## Schritt 5 — Wichtig: Rebuild bei `build:`-Stacks

Beide Services bauen aus dem Quellcode (`build: ./backend`, `build: ./frontend`).
Portainer zieht bei einem GitOps-Update den neuen Repo-Stand und deployt neu. Sollte
ein Update mal die Quelltext-Aenderung **nicht** uebernehmen (alter Image-Layer aus
Cache), gibt es zwei Absicherungen:

- In Portainer beim Redeploy die Option **"Re-pull image and redeploy" / "Force rebuild"**
  aktivieren (Stack-Detailseite), bzw. beim Stack die GitOps-Option entsprechend setzen.
- Garantierter Fallback per SSH:
  ```bash
  ssh <user>@192.168.2.10
  cd /volume1/docker/shelly-admin   # bzw. der von Portainer geklonte Stack-Pfad
  sudo docker compose up -d --build
  ```

Das benannte Volume `shelly-admin-data` bleibt bei jedem Rebuild/Redeploy erhalten
(Admin-Konto, Geraeteliste, Instanz-Secret) — es liegt bewusst NICHT im geklonten
Stack-Verzeichnis. Beim ersten Einrichten einmal bewusst eine sichtbare Mini-Aenderung
pushen und pruefen, ob sie nach dem Redeploy im Browser ankommt — dann weisst du, ob
Polling/Rebuild sauber durchlaeuft.

---

## Schritt 6 — (Optional) Sofort-Redeploy per Webhook

1. Portainer: Stack `shelly-admin` -> Webhook-URL kopieren (nur sichtbar, wenn beim
   Anlegen Webhook aktiviert wurde).
2. Gitea: Repo `shelly-admin` -> *Settings* -> *Webhooks* -> *Add Webhook* -> *Gitea*:
   - Target URL = die Portainer-Webhook-URL
   - Trigger = *Push events*
   - Branch filter = `main`
3. *Test Delivery* ausloesen -> Portainer sollte einen Redeploy starten.

---

## Verifikation

```bash
# Backend gesund?
curl http://192.168.2.10:8083/api/health      # erwartet: {"ok":true}
# Logs ansehen
sudo docker compose logs -f backend
```

Browser: **http://192.168.2.10:8083** (bei alter Seite einmal Strg+F5) -> Erst-Setup.

---

## Taeglicher Workflow danach

```powershell
# 1. lokal entwickeln & ansehen
npm run dev

# 2. zufrieden? committen & pushen
git add -A
git commit -m "..."
git push          # GitHub
git push gitea    # NAS -> loest Deployment aus (bzw. nur "git push", falls beide Push-URLs gesetzt)

# 3. NAS aktualisiert sich selbst (Polling/Webhook). Fertig.
```

Reine Wert-Aenderungen (z. B. `CONTROL_MODE`, `DEFAULT_SUBNET`, `REFRESH_SECONDS`) macht
man in den **Portainer-Stack-Env-Variablen** und deployt den Stack neu — dafuer ist kein
Git-Push noetig.
