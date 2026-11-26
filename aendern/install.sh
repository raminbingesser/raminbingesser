#!/bin/bash
# Installiert „Ändern“: Skill /aendern für Claude (Desktop App & Claude Code)
# und legt die Chrome-Erweiterung an einen festen Ort.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$HOME/.claude/skills/aendern"
EXT_DIR="$HOME/Library/Application Support/Aendern/chrome-erweiterung"
[ "$(uname)" = "Darwin" ] || EXT_DIR="$HOME/.local/share/aendern/chrome-erweiterung"

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
echo "  3. „Entpackte Erweiterung laden“ → diesen Ordner wählen:"
echo "     $EXT_DIR"
echo "     (Der Ordner wurde gerade im Finder geöffnet. Im Auswahldialog: ⌘⇧G und den Pfad einfügen.)"
echo
echo "Danach: Auf deiner App (localhost) unten rechts ✎ → Element anklicken → Wunsch → Enter."
echo "In der Claude Desktop App: /aendern"
[ "$(uname)" = "Darwin" ] && open "$EXT_DIR" 2>/dev/null || true
printf "%s" "$EXT_DIR" | pbcopy 2>/dev/null && echo "(Pfad ist in der Zwischenablage.)" || true
