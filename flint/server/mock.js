// Demo-Modus (npm run demo): simuliert einen Agenten, ohne Claude aufzurufen.
// Nützlich, um die Oberfläche auszuprobieren. Baut ein echtes Beispiel-Dashboard
// im Projektordner, damit die Vorschau etwas zeigt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
});

const DASHBOARD = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Umsatz-Dashboard</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1b1b1b;--muted:#6b6b6b;--line:#e7e5e0;--a:#e8590c}
@media (prefers-color-scheme:dark){:root{--bg:#121213;--card:#1b1b1d;--ink:#eee;--muted:#9a9a9a;--line:#2a2a2d}}
body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:1000px;margin:0 auto;padding:28px 18px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 22px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.v{font-size:26px;font-weight:650;margin-top:6px}
.up{color:#2f9e44;font-size:12px}.down{color:#e03131;font-size:12px}
svg{width:100%;height:220px}
</style></head><body><main>
<h1>Umsatz-Dashboard</h1><p class="sub">Beispieldaten · letzte 12 Monate</p>
<div class="kpis">
<div class="card"><div class="k">Umsatz</div><div class="v">128.400 €</div><div class="up">▲ 12 % ggü. Vorjahr</div></div>
<div class="card"><div class="k">MRR</div><div class="v">42.100 €</div><div class="up">▲ 4 %</div></div>
<div class="card"><div class="k">Kunden</div><div class="v">1.284</div><div class="up">▲ 86 neu</div></div>
<div class="card"><div class="k">Churn</div><div class="v">2,1 %</div><div class="down">▲ 0,3 Pkt.</div></div>
</div>
<div class="card"><div class="k">Monatsumsatz</div><svg id="c" viewBox="0 0 600 220" preserveAspectRatio="none"></svg></div>
</main><script>
const d=[7.1,7.8,8.2,8.0,9.1,9.6,10.2,10.0,11.4,11.9,12.6,13.3],w=600,h=200,mx=14;
const pts=d.map((v,i)=>[i*(w/(d.length-1)),h-v/mx*h+10]);
const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
document.getElementById('c').innerHTML='<path d="'+line+' L600 220 L0 220Z" fill="#e8590c" opacity=".12"/><path d="'+line+'" fill="none" stroke="#e8590c" stroke-width="2.5"/>'+pts.map(p=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3.5" fill="#e8590c"/>').join('');
</script></body></html>
`;

export function mockQuery({ prompt, options }) {
  const sessionId = options.resume || crypto.randomUUID();
  const signal = options.abortController?.signal;
  const base = { session_id: sessionId, parent_tool_use_id: null, uuid: crypto.randomUUID() };
  const assistant = (content) => ({ ...base, type: 'assistant', message: { role: 'assistant', content } });
  const toolResult = (id, text) => ({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

  async function* gen() {
    yield { ...base, type: 'system', subtype: 'init', cwd: options.cwd, tools: [], model: options.model };
    if (/frage/i.test(prompt) && options.canUseTool) {
      const input = { questions: [{ question: 'Welche Diagrammart möchtest du?', header: 'Diagramm', multiSelect: false, options: [
        { label: 'Linien', description: 'Verlauf über Zeit' }, { label: 'Balken', description: 'Monate vergleichen' }, { label: 'Fläche', description: 'Volumen betonen' }] }] };
      const res = await options.canUseTool('AskUserQuestion', input, { signal, suggestions: [] });
      const ans = res.behavior === 'allow' ? Object.values(res.updatedInput.answers || {})[0] : 'keine Antwort';
      const t = `Alles klar, ich nehme: **${ans}**. (Demo-Modus)`;
      yield assistant([{ type: 'text', text: t }]);
      yield { ...base, type: 'result', subtype: 'success', is_error: false, result: t, total_cost_usd: 0, duration_ms: 900, num_turns: 1, usage: {} };
      return;
    }
    const intro = `Alles klar. (Demo-Modus, Claude wird nicht aufgerufen.) Ich baue dir dazu ein kleines Dashboard in \`dashboard/index.html\`.`;
    for (const word of intro.split(/(?<= )/)) {
      await sleep(35, signal);
      yield { ...base, type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } } };
    }
    yield assistant([{ type: 'text', text: intro }]);

    await sleep(400, signal);
    const t1 = 'toolu_' + crypto.randomBytes(4).toString('hex');
    const file = path.join(options.cwd, 'dashboard', 'index.html');
    yield assistant([{ type: 'tool_use', id: t1, name: 'Write', input: { file_path: file, content: DASHBOARD.slice(0, 160) + '…' } }]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, DASHBOARD);
    await sleep(300, signal);
    yield toolResult(t1, `Datei geschrieben: ${file}`);

    // Rechte-Abfrage zeigen (wie bei echten Bash-Befehlen).
    const t2 = 'toolu_' + crypto.randomBytes(4).toString('hex');
    const cmd = { command: 'ls -la dashboard', description: 'Ergebnis prüfen' };
    let allowed = true;
    if (options.permissionMode !== 'bypassPermissions' && options.canUseTool) {
      const res = await options.canUseTool('Bash', cmd, { signal, suggestions: [] });
      allowed = res.behavior === 'allow';
    }
    yield assistant([{ type: 'tool_use', id: t2, name: 'Bash', input: cmd }]);
    await sleep(300, signal);
    yield toolResult(t2, allowed ? `-rw-r--r--  1 du  staff  ${DASHBOARD.length}  index.html` : 'Abgelehnt.');

    const outro = `Fertig. Das Dashboard liegt in \`dashboard/index.html\`. Öffne in der Vorschau „Projektdatei“ → \`dashboard/index.html\`.\n\nDeine Nachricht war: „${prompt.slice(0, 200)}“`;
    yield assistant([{ type: 'text', text: outro }]);
    yield { ...base, type: 'result', subtype: 'success', is_error: false, result: outro, total_cost_usd: 0, duration_ms: 2100, num_turns: 3, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const it = gen();
  it.interrupt = async () => { options.abortController?.abort(); };
  return it;
}
