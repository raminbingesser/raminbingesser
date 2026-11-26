---
name: aendern
description: Setzt Änderungen um, die der Nutzer in Chrome mit der Erweiterung „Ändern“ an Elementen seiner lokalen App (localhost) markiert hat, und wartet danach im Live-Modus auf weitere Änderungen direkt aus Chrome. Verwenden bei /aendern oder wenn der Nutzer sagt „mach die markierten Änderungen“, „übernimm die Änderungen aus Chrome“ o. Ä.
allowed-tools: Bash(node ~/.claude/skills/aendern/aendern.mjs:*), Read, Edit, MultiEdit, Grep, Glob
---

# /aendern: markierte Änderungen umsetzen (Live-Modus)

Der Nutzer klickt in Chrome auf seiner lokalen App Elemente an und schreibt dazu, was sich ändern soll. Die Erweiterung „Ändern“ schickt das direkt an dich. Setze es **schnell und genau** um und warte dann auf die nächste Änderung.

## Ablauf

1. Liegengebliebene Änderungen aus der Zwischenablage holen:
   ```
   node ~/.claude/skills/aendern/aendern.mjs holen
   ```
   Gibt es offene Änderungen, setze sie um (Schritt 3). Bei `KEINE_AENDERUNGEN` oder `ALLES_ERLEDIGT`: nichts sagen, weiter mit Schritt 2. Bei `FEHLER`: ignorieren, weiter mit Schritt 2.

2. Dem Nutzer **einmal** kurz sagen: „Live-Modus an: Klick in Chrome ein Element an, schreib den Wunsch, Enter. Beenden mit Esc.“ Dann auf Änderungen warten, **immer mit Bash-Timeout 600000**:
   ```
   node ~/.claude/skills/aendern/aendern.mjs warten
   ```
   - Ausgabe `KEINE_NEUEN`: sofort wieder `warten` aufrufen, ohne etwas zu schreiben.
   - Ausgabe `BELEGT` oder `FEHLER`: Hinweis in einem Satz weitergeben und aufhören.
   - Sonst: die Änderungen umsetzen (Schritt 3), dann **sofort wieder `warten`**.
   Hör nie von selbst auf zu warten. Der Nutzer beendet den Live-Modus mit Esc.

3. Für **jede** Änderung:
   - Finde die Stelle im Quellcode des aktuellen Projekts. Am schnellsten per Grep nach dem sichtbaren **Text**, der **ID** oder markanten **Klassen** aus Selektor/HTML. Die **Seite** (URL-Pfad) hilft, die richtige Datei/Route zu finden. Das Element kann aus einer Vorlage, Komponente, Schleife oder aus Daten stammen.
   - Setze **genau den Wunsch** um, beschränkt auf dieses Element. So klein wie möglich, im vorhandenen Stil (bestehende CSS-Klassen/Variablen nutzen statt Inline-Styles, wenn das Projekt so arbeitet).
   - Ändere Dateien **nur mit dem Edit-Werkzeug**, nie mit sed, awk, perl oder echo.
   - Ist eine Änderung wirklich mehrdeutig, setze sie so sinnvoll wie möglich um und sag das in deinem Satz.
   - Danach alle umgesetzten IDs in einem Aufruf merken:
     ```
     node ~/.claude/skills/aendern/aendern.mjs erledigt <id1> <id2> …
     ```
   - Pro Änderung **ein kurzer Satz** auf Deutsch, was geändert wurde (Datei). Mehr nicht.

## Nicht tun
- Nicht testen, keinen Browser öffnen, keine Screenshots, keine Server starten oder neu starten, keine Commits.
- Nichts anderes „mitverbessern“.
- Keine langen Berichte, keine Rückfragen, die das Warten unterbrechen.

Der Nutzer sieht das Ergebnis selbst in Chrome (die Seite lädt bei Hot Reload von selbst neu, sonst einmal neu laden).
