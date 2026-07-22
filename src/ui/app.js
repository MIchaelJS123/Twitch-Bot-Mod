const api = window.api;
let config;

function $(id) { return document.getElementById(id); }

function renderCommands() {
  const body = $('cmdTable').querySelector('tbody');
  body.innerHTML = '';
  config.commands.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.trigger}</td><td>${c.response}</td><td>${c.type}</td>`;
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => { config.commands.splice(i, 1); renderCommands(); };
    td.appendChild(del); tr.appendChild(td); body.appendChild(tr);
  });
}

function load() {
  $('clientId').value = config.auth.clientId;
  $('clientSecret').value = config.auth.clientSecret;
  $('modEnabled').checked = config.moderation.enabled;
  $('capsPercent').value = config.moderation.capsPercent;
  $('maxLinks').value = config.moderation.maxLinks;
  $('maxSymbolPercent').value = config.moderation.maxSymbolPercent;
  $('bannedWords').value = config.moderation.bannedWords.join(', ');
  renderCommands();
}

function collect() {
  config.auth.clientId = $('clientId').value.trim();
  config.auth.clientSecret = $('clientSecret').value.trim();
  config.moderation.enabled = $('modEnabled').checked;
  config.moderation.capsPercent = Number($('capsPercent').value);
  config.moderation.maxLinks = Number($('maxLinks').value);
  config.moderation.maxSymbolPercent = Number($('maxSymbolPercent').value);
  config.moderation.bannedWords = $('bannedWords').value.split(',').map(s => s.trim()).filter(Boolean);
}

$('addCmd').onclick = () => {
  const trigger = $('cTrigger').value.trim();
  if (!trigger.startsWith('!')) { alert('Trigger must start with !'); return; }
  config.commands.push({ trigger, response: $('cResponse').value, type: $('cType').value, count: 0, cooldownSec: 5, permission: 'everyone' });
  $('cTrigger').value = ''; $('cResponse').value = '';
  renderCommands();
};

$('save').onclick = async () => { collect(); await api.saveConfig(config); $('save').textContent = 'Saved!'; setTimeout(() => $('save').textContent = 'Save Settings', 1200); };
$('authorize').onclick = async () => { collect(); await api.saveConfig(config); const r = await api.beginAuth(); if (!r.ok) alert(r.error); else { config = await api.getConfig(); alert('Authorized as ' + config.auth.login); } };
$('start').onclick = async () => { const r = await api.startBot(); if (!r.ok) alert(r.error); };
$('stop').onclick = async () => { await api.stopBot(); };
$('startPoll').onclick = async () => {
  collect(); await api.saveConfig(config);
  // Polls run through the bot; easiest path is the chat command, but we can also expose an IPC later.
  alert('Use the !poll command in chat, or add a poll IPC in a later iteration.');
};

api.onStatus(s => { $('status').textContent = s; });

(async () => { config = await api.getConfig(); load(); })();
