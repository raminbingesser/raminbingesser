<p align="center"><img src="public/logo.svg" width="96" alt="Flint"></p>

<h1 align="center">Flint</h1>
<p align="center"><b>Sag es. Sieh es entstehen.</b><br>Deine KI-Werkstatt für Dashboards, Tools und Webseiten, mit Claude und deinem Claude-Abo.</p>

---

Links sprichst du mit Claude (tippen oder per Mikrofon), rechts siehst du **live**, was entsteht. Willst du etwas ändern, klickst du einfach darauf und sagst, was anders sein soll.

## Was Flint kann

| | |
|---|---|
| **Live-Vorschau** | Projektdateien oder Dev-Server (Vite, Next …). Lädt automatisch neu, sobald sich eine Datei ändert, egal ob Flint, die Claude Desktop App oder du sie änderst. Ansichten für Desktop, Tablet und Handy. |
| **✎ Ändern per Klick** | In der Vorschau auf „Ändern“, dann auf ein Element klicken (Titel, Diagramm, Button …). Direkt daneben erscheint ein Feld: „größer“, „blau“, „weg damit“, mit Mikrofon. Claude weiß genau, welches Element gemeint ist. Tastenkürzel: ⌘E |
| **Fehler beheben per Klick** | JavaScript-Fehler der Seite erscheinen über der Vorschau → „Claude beheben lassen“. |
| **iOS-Simulator** | Vorschau-Quelle „iOS-Simulator“ zeigt deine native App live. Auf eine Stelle tippen, sagen, was sich ändern soll. Claude baut neu. (Braucht Xcode.) |
| **Mehrere Agenten parallel** | Beliebig viele Sitzungen pro Projekt laufen gleichzeitig. Status in der Seitenleiste, Benachrichtigung bei „fertig“ oder „Freigabe nötig“. |
| **Chef & Helfer** | Claude kann für unabhängige Teilaufgaben selbst Helfer-Sitzungen starten und deren Ergebnisse einsammeln. |
| **Varianten** | Eine Idee sicher ausprobieren, auch 2 bis 3 Varianten parallel. Jede läuft in einer eigenen Kopie (Git-Worktree) mit eigener Vorschau. Danach **Übernehmen** oder **Verwerfen**. |
| **Warteschlange** | Weitertippen, während Claude arbeitet. Nachrichten werden eingereiht, lassen sich umsortieren, pausieren und löschen. |
| **Modell wählen** | Pro Sitzung Opus 5.5, Sonnet 5.5, Haiku 5.5 oder Fable 5.2, dazu die Denktiefe. Jederzeit umstellbar. |
| **Projekt-Brain** | `brain/BRAIN.md` (Mission, Ziele, Regeln, Stil) und `brain/ROADMAP.md` (Kanban-Board zum Ziehen). Alle Agenten kennen es, über `CLAUDE.md` auch Claude in der Desktop App. |
| **Terminal** | Echtes Terminal im Projektordner, auch für „Claude im Terminal“ (Claude Code pur). |
| **Dateien** | Dateibaum mit Editor. CSV- und JSON-Dateien als Tabelle, mit Knopf „Dashboard daraus“. |
| **Versionen** | Sicherungspunkte (Git) mit einem Klick, Änderungen ansehen, verwerfen, hochladen. |
| **MCP & Tools** | Jeden MCP-Server verbinden (Higgsfield, Playwright, Notion, Supabase …), inklusive Anmeldung. Gilt auch für Claude Code im Terminal und in der Desktop App. |
| **Tresor** | API-Keys verschlüsselt auf dem Mac. Agenten bekommen sie als Umgebungsvariablen, nie in Dateien. |
| **Veröffentlichen** | Mit Railway: Claude deployed das Projekt mit der Railway-CLI und nennt dir die Adresse. |
| **Projekte laden** | Neue Projekte aus Vorlagen (Dashboard, Tool, Webseite, React-App), jeden Ordner auf dem Mac öffnen oder aus GitHub laden. |
| **Bilder & Sprache** | Screenshots einfügen oder hineinziehen. Diktat auf Deutsch über das Mikrofon. |
| **Suche** | ⌘K für alles: Sitzungen, Projekte, Aktionen. |

## Installation auf dem Mac

Einmal im Terminal ausführen:

```bash
git clone -b claude/loving-euler-igemj3 https://github.com/raminbingesser/raminbingesser.git ~/Flint-App
bash ~/Flint-App/flint/mac/install.sh
```

Das Skript:
1. prüft bzw. installiert die Apple Command Line Tools (für Git) und Node.js (über Homebrew, sonst Link zu nodejs.org),
2. installiert die Pakete,
3. legt **Flint.app** mit Symbol in `~/Applications` an und startet sie.

Danach startest du Flint wie jede App (Launchpad, Spotlight, Dock). Flint öffnet sich in einem eigenen Fenster: in Chrome, Edge oder Brave ohne Browserleiste, sonst im Standardbrowser.

**Beim ersten Start** prüft Flint, ob alles bereit ist, und meldet dich bei Bedarf mit deinem Claude-Konto (Pro oder Max) an. **Es ist kein API-Key nötig.** Flint nutzt Claude Code mit deinem Abo.

### Ohne App, direkt im Terminal

```bash
cd ~/Flint-App/flint
npm install
npm start          # öffnet http://localhost:4317
npm run demo       # Demo-Modus ohne Claude, zum Ausprobieren der Oberfläche
```

### Aktualisieren

Einstellungen → **Nach Updates suchen**, oder im Terminal `cd ~/Flint-App && git pull && cd flint && npm install`.

## So arbeitest du mit Flint

1. **Neues Projekt** → Vorlage „Dashboard“ → beschreiben, was es zeigen soll → Claude legt los, die Vorschau aktualisiert sich live.
2. In der Vorschau **✎ Ändern** → auf ein Element klicken → „als Balkendiagramm“ → Enter.
3. Größere Idee? In der Seitenleiste am Projekt auf das Varianten-Symbol → **2 Varianten** → vergleichen → die bessere übernehmen.
4. **Versionen** → „Sichern“, wenn ein Stand gut ist.
5. **↑ Veröffentlichen** → Railway.

### Zusammen mit der Claude Desktop App

Beide arbeiten in **denselben Ordnern**. Was die eine ändert, sieht die andere sofort, und die Vorschau in Flint lädt auch bei Änderungen aus der Desktop App neu. Der Chatverlauf wandert nicht mit, dafür gibt es das Projekt-Brain (über `CLAUDE.md` eingebunden). Nur nicht beide gleichzeitig an derselben Datei arbeiten lassen.

## Gut zu wissen

- **Daten:** Einstellungen, Sitzungen und Tresor liegen in `~/.flint`. Neue Projekte standardmäßig in `~/Flint`.
- **Sicherheit:** Flint läuft nur lokal (`127.0.0.1`), die Oberfläche braucht einen Zugangsschlüssel pro Start. Vorschau-Seiten laufen auf einem eigenen Port (4318), getrennt von Flint.
- **Rechte:** Oben im Chat stellst du ein, was Claude ohne Nachfrage darf: *Bei allem fragen*, *Dateien automatisch* (Standard), *Automatisch (geprüft)*, *Alles erlauben*, *Nur planen*.
- **Kontingent:** Alle Agenten teilen sich das Nutzungslimit deines Claude-Abos. Viele parallele Agenten verbrauchen es schneller. Der angezeigte Dollarbetrag ist nur der rechnerische API-Wert, mit Abo zahlst du nichts extra.
- **Persönliche Nutzung:** Flint ist für dich mit deinem eigenen Claude-Konto gedacht.
- **Logs:** `~/.flint/flint.log` (beim Start über die App).

## Technik

Node.js-Server (`server/`) mit dem [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), Express, WebSocket und node-pty. Oberfläche (`public/`) mit Preact und htm, ohne Build-Schritt. Die Agenten sind echtes Claude Code: Sie nutzen deine Claude-Code-Einstellungen, Skills, Plugins und MCP-Server.

```
server/
  index.js     HTTP-, WebSocket- und Vorschau-Server, API
  agents.js    Sitzungen, Warteschlange, Freigaben, Chef/Helfer
  claude.js    Anmeldestatus, MCP-Verwaltung über die Claude-CLI
  variants.js  Varianten (Git-Worktrees)
  brain.js     Projekt-Brain und Roadmap
  files.js     Dateien und Git
  terminal.js  Terminals (node-pty)
  vault.js     verschlüsselter Schlüsseltresor
  store.js     Projekte, Sitzungen, Verläufe (~/.flint)
  mock.js      Demo-Modus
public/
  app.js chat.js work.js modals.js core.js icons.js style.css
  bridge.js    läuft in Vorschau-Seiten: Klick-Auswahl, Fehler, Scrollposition
mac/install.sh Installer und Flint.app
```
