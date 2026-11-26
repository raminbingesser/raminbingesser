# Ändern – für Claude

Elemente deiner lokalen App in **Chrome anklicken**, dazuschreiben, was sich ändern soll, **Enter**. Die Änderung geht **direkt an Claude** in der Desktop App und wird umgesetzt.

## So arbeitest du damit

1. In der **Claude Desktop App** (im Projekt deiner App) **einmal** `/aendern` eingeben. Claude schaltet in den **Live-Modus** und wartet auf Änderungen aus Chrome.
2. Deine App in Chrome öffnen (z. B. `localhost:3333`).
3. **Alt+E** (oder unten rechts **✎**), Element anklicken, Wunsch eintippen (z. B. „größer“, „blau“, „weg damit“), **Enter**.
4. Fertig: Die Änderung geht sofort an Claude, Claude setzt sie um und schreibt einen Satz. Chrome zeigt das Ergebnis (Hot Reload oder einmal neu laden).
5. Nächstes Element: wieder **Alt+E** → klicken → Wunsch → Enter. Du musst in Claude nichts mehr tippen.
6. Live-Modus beenden: in der Desktop App **Esc** bzw. Stopp.

**Wenn Claude gerade nicht wartet** (z. B. weil er noch arbeitet oder du `/aendern` noch nicht eingegeben hast), merkt sich die Erweiterung die Änderung (⏳ in der Liste, Zahl am ✎) und schickt sie automatisch, sobald Claude wieder bereit ist.

**Tipps**
- Rechtsklick auf ✎ zeigt oder versteckt die Liste (✓ = übertragen, ⏳ = wartet).
- Der Empfänger läuft nur, solange Claude im Live-Modus ist, nur auf `127.0.0.1` und nimmt nur Daten von der Erweiterung an, nicht von Webseiten.
- Die Erweiterung ist nur auf `localhost` aktiv, nie auf anderen Webseiten.
- Notfall ohne Live-Modus: Im ✎-Menü „Kopieren“ und mit ⌘V in den Claude-Chat einfügen.

## Installation (einmalig, ca. 2 Minuten)

Im Terminal:

```bash
rm -rf /tmp/aendern-src && git clone -b claude/loving-euler-igemj3 https://github.com/raminbingesser/raminbingesser.git /tmp/aendern-src && bash /tmp/aendern-src/aendern/install.sh
```

Das Skript:
- installiert den Skill nach `~/.claude/skills/aendern` (gilt für die Claude Desktop App und Claude Code im Terminal),
- legt die Chrome-Erweiterung in den sichtbaren Ordner `~/Aendern-Erweiterung` und öffnet deinen Benutzerordner im Finder.

Dann in Chrome:
1. Adresse **`chrome://extensions`** öffnen.
2. Oben rechts **Entwicklermodus** einschalten.
3. **„Entpackte Erweiterung laden“** → im Dialog links auf deinen **Benutzernamen** (oder ⌘⇧H) → Ordner **`Aendern-Erweiterung`** einmal anklicken → **„Auswählen“**. Alternativ den Ordner aus dem Finder direkt in den Dialog ziehen. Den Ordner danach nicht löschen.
4. Optional: Auf das Puzzle-Symbol klicken und „Ändern“ anpinnen.

Laufende Tabs mit deiner App einmal neu laden, dann erscheint das ✎.

**Update:** Den Befehl oben erneut ausführen, dann in `chrome://extensions` bei „Ändern“ auf ⟳ (Neu laden) klicken und die App-Tabs neu laden.

**Voraussetzung:** Node.js (hast du, da deine App damit läuft).

## Deinstallieren

```bash
rm -rf ~/.claude/skills/aendern ~/.claude/aendern ~/Aendern-Erweiterung
```
und in `chrome://extensions` die Erweiterung „Ändern – für Claude“ entfernen.
