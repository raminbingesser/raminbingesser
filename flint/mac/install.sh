#!/bin/bash
# Flint auf dem Mac einrichten: Abhängigkeiten installieren und Flint.app
# (mit Symbol) in ~/Applications anlegen. Mehrfach ausführen ist unbedenklich.
set -e

FLINT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true

orange() { printf "\033[38;5;208m%s\033[0m\n" "$1"; }
orange "▲ Flint wird eingerichtet…"
echo "  Ordner: $FLINT_DIR"

# --- Git / Apple Command Line Tools -------------------------------------------
if ! xcode-select -p >/dev/null 2>&1; then
  echo "• Installiere Apple Command Line Tools (enthält Git)…"
  xcode-select --install || true
  echo "  Bitte die Installation im Dialog abschließen und dieses Skript danach erneut starten."
  exit 1
fi

# --- Node.js 20+ ----------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "• Installiere Node.js über Homebrew…"
    brew install node
  else
    echo "  Node.js 20 oder neuer fehlt."
    echo "  Bitte die LTS-Version von https://nodejs.org installieren und dieses Skript erneut starten."
    open "https://nodejs.org/" || true
    exit 1
  fi
fi
echo "• Node $(node -v)"

# --- Pakete -------------------------------------------------------------------------
echo "• Installiere Pakete (das dauert beim ersten Mal ein bis zwei Minuten)…"
cd "$FLINT_DIR"
npm install --no-audit --no-fund --loglevel=error

# --- Flint.app ----------------------------------------------------------------------
APP="$HOME/Applications/Flint.app"
echo "• Erstelle $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

TMP="$(mktemp -d)"
ICONSET="$TMP/Flint.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$FLINT_DIR/assets/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$FLINT_DIR/assets/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Flint.icns"
rm -rf "$TMP"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Flint</string>
  <key>CFBundleDisplayName</key><string>Flint</string>
  <key>CFBundleIdentifier</key><string>local.flint.app</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Flint</string>
  <key>CFBundleIconFile</key><string>Flint</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

sed "s|__FLINT_DIR__|$FLINT_DIR|" "$FLINT_DIR/mac/launcher.sh" > "$APP/Contents/MacOS/Flint"
chmod +x "$APP/Contents/MacOS/Flint"
touch "$APP"

# --- Claude-Anmeldung prüfen ----------------------------------------------------------
CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(ls "$FLINT_DIR"/node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/claude 2>/dev/null | head -1)"
fi
if [ -n "$CLAUDE_BIN" ] && ! "$CLAUDE_BIN" auth status --text 2>/dev/null | grep -qi "logged in\|angemeldet"; then
  echo "• Hinweis: Falls du noch nicht bei Claude angemeldet bist, macht Flint das beim ersten Start mit dir."
fi

orange "✓ Fertig!"
echo "  Flint liegt jetzt in deinem Programme-Ordner (~/Applications)."
echo "  Tipp: Flint ins Dock ziehen. Starte Flint jetzt…"
open "$APP"
