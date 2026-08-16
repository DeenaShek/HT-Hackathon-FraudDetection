const API = '';
const socket = io();

let users = [];
let allTx = [];
let currentUserId = null;

const identitySelect = document.getElementById('identity');
const balanceEl = document.getElementById('balance');
const incomingList = document.getElementById('incomingList');
const outgoingList = document.getElementById('outgoingList');
const toast = document.getElementById('toast');

function money(n) { return '\u20b9 ' + Number(n).toLocaleString('en-IN'); }

function renderAll() {
  const me = users.find(u => u.id === currentUserId);
  balanceEl.textContent = me ? money(me.balance) : '\u20b9 0';

  const incoming = allTx.filter(t => t.receiverId === currentUserId).slice().reverse();
  const outgoing = allTx.filter(t => t.senderId === currentUserId).slice().reverse();

  incomingList.innerHTML = incoming.length ? incoming.map(t => `
    <div class="tx-item">
      <div>
        <div class="from">${t.senderName}
          <span class="tier-pill tier-${t.risk?.tier || 'LOW'}">${t.risk?.tier || ''}</span>
        </div>
        <div class="meta">${new Date(t.timestamp).toLocaleTimeString()} \u2022 ${t.status.replace('_',' ')}</div>
      </div>
      <div class="tx-amt in">+${money(t.amount)}</div>
    </div>
  `).join('') : '<div class="empty">No incoming payments yet.</div>';

  outgoingList.innerHTML = outgoing.length ? outgoing.map(t => `
    <div class="tx-item">
      <div>
        <div class="from">to ${t.receiverName}</div>
        <div class="meta">${new Date(t.timestamp).toLocaleTimeString()} \u2022 ${t.status.replace('_',' ')}</div>
      </div>
      <div class="tx-amt out">-${money(t.amount)}</div>
    </div>
  `).join('') : '<div class="empty">Nothing sent from this wallet yet.</div>';
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 3200);
}

async function loadUsers() {
  const res = await fetch(API + '/api/users');
  users = await res.json();
  const receivers = users.filter(u => u.type === 'receiver' || u.type === 'both');
  identitySelect.innerHTML = receivers.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  currentUserId = receivers[0]?.id;
  renderAll();
}

identitySelect.addEventListener('change', (e) => {
  currentUserId = e.target.value;
  renderAll();
});

let lastSeenCount = 0;
socket.on('state', (state) => {
  users = state.users;
  const wasIncoming = allTx.filter(t => t.receiverId === currentUserId).length;
  allTx = state.transactions;
  const nowIncoming = allTx.filter(t => t.receiverId === currentUserId).length;
  if (nowIncoming > wasIncoming) {
    const newest = allTx.filter(t => t.receiverId === currentUserId).slice(-1)[0];
    if (newest) showToast(`\ud83d\udcb0 Received ${money(newest.amount)} from ${newest.senderName}`);
  }
  renderAll();
});

loadUsers();
