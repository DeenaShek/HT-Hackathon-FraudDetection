const API = ''; // same origin (served by the Express backend)
const socket = io();

let users = [];
let currentUserId = null;
// Simulated device/geo fingerprint. "Rotate device" lets you demo the
// DEVICE_HOPPING anomaly rule.
let deviceId = 'device_' + Math.random().toString(36).slice(2, 8);
let geo = 'Chennai,IN';

const identitySelect = document.getElementById('identity');
const receiverSelect = document.getElementById('receiver');
const balanceEl = document.getElementById('balance');
const deviceChip = document.getElementById('deviceChip');
const payForm = document.getElementById('payForm');
const resultCard = document.getElementById('resultCard');
const historyList = document.getElementById('historyList');

function money(n) { return '\u20b9 ' + Number(n).toLocaleString('en-IN'); }

async function loadUsers() {
  const res = await fetch(API + '/api/users');
  users = await res.json();
  const senders = users.filter(u => u.type === 'sender' || u.type === 'both');
  identitySelect.innerHTML = senders.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  currentUserId = senders[0]?.id;
  renderReceivers();
  renderBalance();
  deviceChip.textContent = 'device: ' + deviceId.slice(0, 14) + '\u2026 \u2022 ' + geo;
  renderHistory();
}

function renderReceivers() {
  const others = users.filter(u => u.id !== currentUserId);
  receiverSelect.innerHTML = others.map(u => `<option value="${u.id}">${u.name} (${u.handle})</option>`).join('');
}

function renderBalance() {
  const me = users.find(u => u.id === currentUserId);
  balanceEl.textContent = me ? money(me.balance) : '\u20b9 0';
}

function renderHistory() {
  const mine = (window.__allTx || []).filter(t => t.senderId === currentUserId).slice(-6).reverse();
  historyList.innerHTML = mine.map(t => `
    <div class="hist-item">
      <div>
        <div class="to"><span class="status-dot dot-${t.status}"></span>To ${t.receiverName}</div>
        <div class="meta">${new Date(t.timestamp).toLocaleTimeString()} \u2022 risk ${t.risk?.score ?? '—'} (${t.risk?.tier ?? '—'})</div>
      </div>
      <div class="hist-amt">${money(t.amount)}</div>
    </div>
  `).join('') || '<div class="meta">No transactions yet.</div>';
}

identitySelect.addEventListener('change', (e) => {
  currentUserId = e.target.value;
  renderReceivers();
  renderBalance();
  renderHistory();
});

document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('amount').value = btn.dataset.amt;
  });
});

payForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = payForm.querySelector('.pay-btn');
  btn.disabled = true;
  btn.textContent = 'Processing\u2026';

  const body = {
    senderId: currentUserId,
    receiverId: receiverSelect.value,
    amount: Number(document.getElementById('amount').value),
    note: document.getElementById('note').value,
    deviceId, geo
  };

  try {
    const res = await fetch(API + '/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment failed');

    const tx = data.tx;
    resultCard.classList.remove('hidden', 'ok', 'held');
    resultCard.classList.add(tx.status === 'held_for_review' ? 'held' : 'ok');
    resultCard.innerHTML = `
      <span class="tier-badge tier-${tx.risk.tier}">${tx.risk.tier} RISK \u2022 ${tx.risk.score}/100</span>
      <div>${tx.status === 'held_for_review'
        ? '\u23f8\ufe0f Payment held for review \u2014 our fraud engine flagged this one.'
        : '\u2705 Payment sent.'}</div>
      <div style="margin-top:6px; color:#6b6480; font-size:0.78rem;">${tx.risk.explanation}</div>
    `;
    payForm.reset();
  } catch (err) {
    resultCard.classList.remove('hidden', 'ok');
    resultCard.classList.add('held');
    resultCard.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pay securely';
  }
});

document.getElementById('deviceChip').addEventListener('click', () => {
  // quick way to demo the device-hopping rule: click the chip to "switch phones"
  deviceId = 'device_' + Math.random().toString(36).slice(2, 8);
  geo = geo === 'Chennai,IN' ? 'Lagos,NG' : 'Chennai,IN';
  deviceChip.textContent = 'device: ' + deviceId.slice(0, 14) + '\u2026 \u2022 ' + geo;
});

socket.on('state', (state) => {
  users = state.users;
  window.__allTx = state.transactions;
  renderBalance();
  renderHistory();
});

loadUsers();
