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
  $('aiEnabled').checked = config.ai.enabled;
  $('aiApiKey').value = config.ai.apiKey;
  $('aiModel').value = config.ai.model;
  $('aiPersona').value = config.ai.persona;
  $('aiMaxChars').value = config.ai.maxReplyChars;
  $('rewardStatus').textContent = config.ai.reward ? `Reward: ${config.ai.reward.title} (${config.ai.reward.cost})` : 'No reward yet';
  $('timersEnabled').checked = config.timers.enabled;
  $('timerInterval').value = config.timers.intervalMinutes;
  $('timerMinLines').value = config.timers.minChatLines;
  $('timerRephrase').checked = config.timers.aiRephrase;
  $('timerMessages').value = config.timers.messages.join('\n');
  renderQuotes();
}

function collect() {
  config.auth.clientId = $('clientId').value.trim();
  config.auth.clientSecret = $('clientSecret').value.trim();
  config.moderation.enabled = $('modEnabled').checked;
  config.moderation.capsPercent = Number($('capsPercent').value);
  config.moderation.maxLinks = Number($('maxLinks').value);
  config.moderation.maxSymbolPercent = Number($('maxSymbolPercent').value);
  config.moderation.bannedWords = $('bannedWords').value.split(',').map(s => s.trim()).filter(Boolean);
  config.ai.enabled = $('aiEnabled').checked;
  config.ai.apiKey = $('aiApiKey').value.trim();
  config.ai.model = $('aiModel').value;
  config.ai.persona = $('aiPersona').value;
  config.ai.maxReplyChars = Number($('aiMaxChars').value);
  config.timers.enabled = $('timersEnabled').checked;
  config.timers.intervalMinutes = Number($('timerInterval').value);
  config.timers.minChatLines = Number($('timerMinLines').value);
  config.timers.aiRephrase = $('timerRephrase').checked;
  config.timers.messages = $('timerMessages').value.split('\n').map(s => s.trim()).filter(Boolean);
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

function renderQuotes() {
  const body = $('quoteTable').querySelector('tbody');
  body.innerHTML = '';
  config.quotes.forEach((q, i) => {
    const tr = document.createElement('tr');
    const idTd = document.createElement('td'); idTd.textContent = q.id;
    const txtTd = document.createElement('td'); txtTd.textContent = q.text;
    const btnTd = document.createElement('td');
    const del = document.createElement('button'); del.textContent = 'x';
    del.onclick = () => { config.quotes.splice(i, 1); renderQuotes(); };
    btnTd.appendChild(del);
    tr.append(idTd, txtTd, btnTd); body.appendChild(tr);
  });
}

$('addQuote').onclick = () => {
  const text = $('qText').value.trim();
  if (!text) return;
  const id = (config.quotes.at(-1)?.id ?? 0) + 1;
  config.quotes.push({ id, text, addedBy: 'dashboard', addedAt: new Date().toISOString() });
  $('qText').value = '';
  renderQuotes();
};

$('createReward').onclick = async () => {
  collect(); await api.saveConfig(config);
  const r = await api.createReward($('rewardName').value.trim(), Number($('rewardCost').value));
  if (!r.ok) { $('rewardStatus').textContent = 'Error: ' + r.error; return; }
  config = await api.getConfig();
  $('rewardStatus').textContent = `Reward: ${r.reward.title} (${r.reward.cost})`;
};

api.onStatus(s => { $('status').textContent = s; });

(async () => { config = await api.getConfig(); load(); })();
