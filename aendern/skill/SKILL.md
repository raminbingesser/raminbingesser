---
name: aendern
description: Setzt Änderungen um, die der Nutzer in Chrome mit der Erweiterung „Ändern“ an Elementen seiner lokalen App (localhost) markiert hat. Verwenden bei /aendern oder wenn der Nutzer sagt „mach die markierten Änderungen“, „übernimm die Änderungen aus Chrome“ o. Ä.
allowed-tools: Bash(node ~/.claude/skills/aendern/aendern.mjs:*), Read, Edit, MultiEdit, Grep, Glob
---

# /aendern: markierte Änderungen umsetzen

Der Nutzer hat in Chrome auf seiner lokalen App Elemente angeklickt und zu jedem geschrieben, was sich ändern soll. Die Erweiterung „Ändern“ hat das in die Zwischenablage gelegt. Setze es **schnell und genau** um.

## Ablauf

1. Offene Änderungen holen:
   ```
   node ~/.claude/skills/aendern/aendern.mjs holen
   ```
   - Beginnt die Ausgabe mit `KEINE_AENDERUNGEN`, `ALLES_ERLEDIGT` oder `FEHLER`: gib den Hinweis daraus in einem Satz weiter und hör auf.

2. Für **jede** Änderung:
   - Finde die Stelle im Quellcode des aktuellen Projekts. Am schnellsten per Grep nach dem sichtbaren **Text**, der **ID** oder markanten **Klassen** aus Selektor/HTML. Die **Seite** (URL-Pfad) hilft, die richtige Datei/Route zu finden. Das Element kann aus einer Vorlage, Komponente, Schleife oder aus Daten stammen.
   - Setze **genau den Wunsch** um, beschränkt auf dieses Element. So klein wie möglich, im vorhandenen Stil (bestehende CSS-Klassen/Variablen nutzen statt Inline-Styles, wenn das Projekt so arbeitet).
   - Ändere Dateien **nur mit dem Edit-Werkzeug**, nie mit sed, awk, perl oder echo.
   - Ist eine Änderung wirklich mehrdeutig, setze die übrigen um und frag am Ende kurz nach.

3. Erledigte merken (alle umgesetzten IDs in einem Aufruf):
   ```
   node ~/.claude/skills/aendern/aendern.mjs erledigt <id1> <id2> …
   ```

4. Antwort: pro Änderung **ein kurzer Satz** auf Deutsch, was geändert wurde (Datei). Mehr nicht.

## Nicht tun
- Nicht testen, keinen Browser öffnen, keine Screenshots, keine Server starten oder neu starten, keine Commits.
- Nichts anderes „mitverbessern“.
- Keine langen Berichte oder Zusammenfassungen.

Der Nutzer sieht das Ergebnis selbst in Chrome (die Seite lädt bei Hot Reload von selbst neu, sonst einmal neu laden).
