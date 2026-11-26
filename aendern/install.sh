#!/bin/bash
# Installiert „Ändern“: Skill /aendern für Claude (Desktop App & Claude Code)
# und legt die Chrome-Erweiterung an einen festen Ort.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$HOME/.claude/skills/aendern"
# Sichtbarer Ordner im Benutzerordner, damit er im Chrome-Dialog leicht zu finden ist
EXT_DIR="$HOME/Aendern-Erweiterung"

echo "▲ Installiere „Ändern“…"
mkdir -p "$SKILL_DIR" "$EXT_DIR"
cp "$SRC/skill/SKILL.md" "$SRC/skill/aendern.mjs" "$SKILL_DIR/"
cp "$SRC/extension/"* "$EXT_DIR/"

if ! command -v node >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/node ] && [ ! -x /usr/local/bin/node ]; then
  echo "  Hinweis: Node.js fehlt. Der Skill braucht es (z. B. brew install node)."
fi

echo "✓ Skill installiert: $SKILL_DIR"
echo "✓ Chrome-Erweiterung liegt in: $EXT_DIR"
echo
echo "Jetzt noch die Erweiterung in Chrome laden (einmalig):"
echo "  1. In Chrome die Adresse  chrome://extensions  öffnen"
echo "  2. Oben rechts „Entwicklermodus“ einschalten"
echo "  3. „Entpackte Erweiterung laden“ → im Dialog links auf deinen Benutzernamen (oder ⌘⇧H)"
echo "     → Ordner „Aendern-Erweiterung“ einmal anklicken → „Auswählen“"
echo "     (Oder den Ordner aus dem eben geöffneten Finder-Fenster in den Dialog ziehen.)"
echo "  Den Ordner danach nicht löschen: Chrome lädt die Erweiterung von dort."
echo
echo "Danach: Auf deiner App (localhost) unten rechts ✎ → Element anklicken → Wunsch → Enter."
echo "In der Claude Desktop App: /aendern"
[ "$(uname)" = "Darwin" ] && open "$HOME" 2>/dev/null || true
