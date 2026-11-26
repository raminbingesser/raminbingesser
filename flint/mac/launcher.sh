#!/bin/bash
# Flint-Starter (Inhalt von ~/Applications/Flint.app/Contents/MacOS/Flint).
# Startet den Flint-Server, falls er nicht läuft, und öffnet Flint – bevorzugt
# als installierte eigene App (Chrome-Web-App mit eigenem Dock-Symbol).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.claude/local:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
FLINT_DIR="__FLINT_DIR__"
PORT="${FLINT_PORT:-4317}"
URL="http://localhost:$PORT/"
AGENT="$HOME/Library/LaunchAgents/local.flint.server.plist"
mkdir -p "$HOME/.flint"

if ! curl -s -o /dev/null --max-time 1 "$URL"; then
  if [ -f "$AGENT" ]; then
    launchctl kickstart "gui/$(id -u)/local.flint.server" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$AGENT"
  else
    cd "$FLINT_DIR" && FLINT_NO_OPEN=1 nohup node server/index.js >> "$HOME/.flint/flint.log" 2>&1 &
  fi
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 1 "$URL" && break
    sleep 0.25
  done
fi

# Als eigene App installiert? (Chrome legt sie hier an)
for app in "$HOME/Applications/Chrome Apps.localized/Flint.app" "$HOME/Applications/Chrome Apps/Flint.app" \
           "$HOME/Applications/Edge Apps.localized/Flint.app" "$HOME/Applications/Brave Browser Apps.localized/Flint.app"; do
  if [ -d "$app" ]; then open "$app"; exit 0; fi
done

# Sonst: eigenes Fenster ohne Browserleiste
for b in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if [ -d "/Applications/$b.app" ] || [ -d "$HOME/Applications/$b.app" ]; then
    open -na "$b" --args --app="$URL" --window-size=1500,950
    exit 0
  fi
done
open "$URL"
