// Klick auf das Erweiterungs-Symbol oder Alt+E: Auswahl-Modus auf der aktuellen Seite umschalten.
const toggle = (tab) => { if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'toggle-pick' }).catch(() => { }); };
chrome.action.onClicked.addListener(toggle);
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-pick') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  toggle(tab);
});
