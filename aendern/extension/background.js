const toggle = (tab) => { if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'toggle-pick' }).catch(() => { }); };
chrome.action.onClicked.addListener(toggle);
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-pick') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  toggle(tab);
});

// Live-Modus: Änderungen an Claude schicken (Empfänger läuft nur, solange Claude wartet)
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'send') return;
  fetch('http://127.0.0.1:47321/items', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: msg.items }),
  }).then((r) => reply({ ok: r.ok })).catch(() => reply({ ok: false }));
  return true;
});
