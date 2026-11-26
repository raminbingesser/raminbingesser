// Service Worker: macht Flint als eigene App installierbar und zeigt eine
// freundliche Seite, wenn der Flint-Server gerade nicht läuft. Es wird nichts
// zwischengespeichert; alle Anfragen gehen direkt an Flint.
const OFFLINE = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Flint</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f0f10;color:#ddd;font:15px/1.5 -apple-system,system-ui,sans-serif">
<div style="max-width:440px;text-align:center;padding:24px">
<h2 style="margin:0 0 8px">Flint läuft gerade nicht</h2>
<p style="color:#999">Öffne <b>Flint</b> einmal aus dem Programme-Ordner (Launchpad oder Spotlight). Damit das nicht mehr nötig ist: In Flint unter Einstellungen „Beim Login starten“ einschalten.</p>
<button onclick="location.reload()" style="margin-top:12px;background:#f76707;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;cursor:pointer">Erneut versuchen</button>
<script>setTimeout(() => location.reload(), 4000)</script>
</div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // alles andere unverändert
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
