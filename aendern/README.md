# Ändern – für Claude

Elemente deiner lokalen App in **Chrome anklicken**, dazuschreiben, was sich ändern soll, und in der **Claude Desktop App** einfach **`/aendern`** eingeben. Claude setzt genau diese Änderungen um.

## So arbeitest du damit

1. Deine App in Chrome öffnen (z. B. `localhost:3333`).
2. Unten rechts auf **✎** klicken (oder **Alt+E**). Elemente leuchten beim Drüberfahren orange auf.
3. Auf das Element klicken, das sich ändern soll, z. B. „größer“, „blau“, „weg damit“ eintippen, **Enter**. Oder einen der Schnellknöpfe nehmen.
4. Beliebig viele weitere Elemente anklicken: **Alt+E** → klicken → Wunsch → Enter. Alles wird gesammelt und liegt automatisch in der Zwischenablage.
5. In der **Claude Desktop App** (im Projekt der App): **`/aendern`** eingeben.
6. Claude setzt alle Änderungen um und schreibt pro Änderung einen Satz. Chrome zeigt das Ergebnis (Hot Reload oder einmal neu laden).
7. In Chrome im ✎-Menü **„Alle erledigt“** klicken, um die Liste zu leeren. Vergisst du das, macht es nichts: Claude merkt sich erledigte Änderungen und macht nichts doppelt.

**Tipps**
- Rechtsklick auf ✎ zeigt oder versteckt die Liste.
- Ohne Skill geht es auch: Zwischenablage einfach mit ⌘V in den Claude-Chat einfügen.
- Die Erweiterung ist nur auf `localhost` aktiv, nie auf anderen Webseiten.

## Installation (einmalig, ca. 2 Minuten)

Im Terminal:

```bash
git clone -b claude/loving-euler-igemj3 https://github.com/raminbingesser/raminbingesser.git /tmp/aendern-src
bash /tmp/aendern-src/aendern/install.sh
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

**Voraussetzung:** Node.js (hast du, da deine App damit läuft).

## Deinstallieren

```bash
rm -rf ~/.claude/skills/aendern ~/.claude/aendern ~/Aendern-Erweiterung
```
und in `chrome://extensions` die Erweiterung „Ändern – für Claude“ entfernen.
