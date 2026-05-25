# Shelly-Admin auf Synology (Container Manager)

Projektpfad auf der NAS: `/volume1/docker/shelly-admin`
WebGUI nach dem Start: **http://<nas-ip>:8090**

> Port **8090**, weil **8080** von HomeDash und **8088** von InfluxDB belegt sind.
> Bei Bedarf in `docker-compose.yml` beim `frontend` die linke Zahl ändern.

## 1. `.env` vorbereiten

```bash
cp .env.example .env
```

Für den Standardbetrieb sind keine Pflichtangaben nötig. Sinnvoll:
- `DEFAULT_SUBNET=192.168.1.0/24` (passend zu deinem Heimnetz) – spart Tippen bei der Suche.
- Hinter dem Synology-Reverse-Proxy (HTTPS): `AUTH_COOKIE_SECURE=true`.

Das Admin-Konto wird **nicht** hier gesetzt, sondern beim ersten WebGUI-Aufruf angelegt.

## 2. Methode A — Container Manager (GUI)

1. **Container Manager** → links **Projekt** → **Erstellen**.
2. Projektname: `shelly-admin`
3. Pfad: `/volume1/docker/shelly-admin` (Ordner mit `docker-compose.yml`)
4. Quelle: **„Vorhandene docker-compose.yml verwenden"** → Weiter.
5. Build/Start bestätigen. Beim ersten Mal werden zwei Images gebaut
   (Backend + Frontend) – das dauert auf schwächeren NAS-CPUs ein paar Minuten.
6. Aufrufen: **http://<nas-ip>:8090** → Erst-Setup durchlaufen.

## 2. Methode B — SSH

```bash
ssh <user>@<nas-ip>
cd /volume1/docker/shelly-admin
sudo docker compose up -d --build
```

## 3. Prüfen

```bash
sudo docker compose ps
sudo docker compose logs -f backend
curl http://localhost:8090/api/health     # {"ok":true}
```

## Stolpersteine

- **Geräte werden beim Scan nicht gefunden?** Der Backend-Container muss die LAN-IPs
  der Shellys erreichen. Im Standard-Bridge-Netz klappt der ausgehende HTTP-Zugriff;
  prüfe Firewall/VLAN-Trennung zwischen NAS und Geräten.
- **Port 8090 belegt?** Linke Zahl im `frontend`-Port ändern (z. B. `8091:80`), Projekt neu starten.
- **Daten weg nach Update?** Der Ordner `./data` ist als Volume gemountet und bleibt
  erhalten. Nicht löschen – er enthält Admin-Konto, Geräteliste und das Instanz-Secret.
- **Autostart:** durch `restart: unless-stopped` startet der Stack nach NAS-Reboot von selbst.

## Aktualisieren

Quellen ersetzen (z. B. neu nach `/volume1/docker/shelly-admin` kopieren), dann:
GUI → Projekt → **Aktion → Erstellen/Neu aufbauen**, oder per SSH
`sudo docker compose up -d --build`. Die `data/`-Inhalte bleiben erhalten.

## Passwort ändern / MFA verwalten

Im Web: oben rechts **⚙ → Konto & Sicherheit** → „Passwort → Ändern" bzw. MFA
aktivieren/deaktivieren.

## Passwort/MFA vergessen? Admin zurücksetzen (ohne Datenverlust)

Setzt **nur** das Admin-Konto zurück; Geräteliste und Instanz-Secret (und damit die
verschlüsselten Geräte-Passwörter) bleiben erhalten. Beim nächsten WebGUI-Aufruf läuft
der Einrichtungs-Assistent erneut.

```bash
sudo docker compose exec backend node src/reset-admin.js
# oder lokal:  npm --prefix backend run reset:admin
```

Nur als letzte Option: `data/shelly-admin.json` löschen – dabei geht die Geräteliste verloren.
