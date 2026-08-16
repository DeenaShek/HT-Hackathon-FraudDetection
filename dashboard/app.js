const API = '';
const socket = io();

let state = { transactions: [], alerts: [], users: [] };
let tierChart = null;

const feedEl = document.getElementById('feed');
const alertsTableEl = document.getElementById('alertsTable');
const ruleBarsEl = document.getElementById('ruleBars');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const drawer = document.getElementById('drawer');
const drawerContent = document.getElementById('drawerContent');

function money(n) { return '\u20b9' + Number(n).toLocaleString('en-IN'); }
function timeStr(ts) { return new Date(ts).toLocaleTimeString(); }

function render() {
  renderKpis();
  renderFeed();
  renderChart();
  renderRuleBars();
  renderAlerts();
}

function renderKpis() {
  document.getElementById('kpiTotal').textContent = state.transactions.length;
  document.getElementById('kpiAlerts').textContent = state.alerts.filter(a => a.status === 'open').length;
  document.getElementById('kpiHeld').textContent = state.transactions.filter(t => t.status === 'held_for_review').length;
  document.getElementById('kpiCritical').textContent = state.transactions.filter(t => t.risk?.tier === 'CRITICAL').length;
}

function renderFeed() {
  const items = state.transactions.slice().reverse().slice(0, 40);
  feedEl.innerHTML = items.length ? items.map(t => `
    <div class="feed-item" data-txid="${t.id}">
      <span class="time">${timeStr(t.timestamp)}</span>
      <span class="route">${t.senderName} \u2192 ${t.receiverName}</span>
      <span class="amt">${money(t.amount)}</span>
      <span class="tier-tag tier-${t.risk?.tier || 'LOW'}">${t.risk?.tier || 'LOW'} \u00b7 ${t.risk?.score ?? 0}</span>
    </div>
  `).join('') : '<div class="empty-note">No transactions yet \u2014 send one from the sender app.</div>';

  feedEl.querySelectorAll('.feed-item').forEach(el => {
    el.addEventListener('click', () => openTxDrawer(el.dataset.txid));
  });
}

function renderChart() {
  const tiers = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const counts = tiers.map(t => state.transactions.filter(tx => (tx.risk?.tier || 'LOW') === t).length);
  const ctx = document.getElementById('tierChart');
  if (tierChart) {
    tierChart.data.datasets[0].data = counts;
    tierChart.update();
    return;
  }
  tierChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tiers,
      datasets: [{
        data: counts,
        backgroundColor: ['#3fc98a', '#f0a63c', '#e35555', '#ff5252'],
        borderRadius: 6,
        barThickness: 34
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8a91a6', font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { color: '#8a91a6', stepSize: 1 }, grid: { color: '#232a3a' } }
      }
    }
  });
}

function renderRuleBars() {
  const counts = {};
  state.transactions.forEach(t => (t.risk?.triggeredRules || []).forEach(r => {
    counts[r.label] = (counts[r.label] || 0) + 1;
  }));
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...entries.map(e => e[1]));
  ruleBarsEl.innerHTML = entries.length ? entries.map(([label, count]) => `
    <div class="rule-bar-row">
      <span>${label}</span><span>${count}</span>
      <div class="rule-bar-track"><div class="rule-bar-fill" style="width:${(count / max) * 100}%"></div></div>
    </div>
  `).join('') : '<div class="empty-note">No anomalies triggered yet.</div>';
}

function renderAlerts() {
  const sorted = state.alerts.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (!sorted.length) {
    alertsTableEl.innerHTML = '<div class="empty-note">No alerts yet.</div>';
    return;
  }
  alertsTableEl.innerHTML = `
    <table>
      <thead><tr>
        <th>Time</th><th>Transaction</th><th>Score</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${sorted.map(a => {
          const tx = state.transactions.find(t => t.id === a.txId);
          return `
          <tr>
            <td>${timeStr(a.createdAt)}</td>
            <td>${tx ? `${tx.senderName} \u2192 ${tx.receiverName} \u00b7 ${money(tx.amount)}` : a.txId}</td>
            <td><span class="tier-tag tier-${a.tier}">${a.tier} \u00b7 ${a.score}</span></td>
            <td><span class="status-pill status-${a.status}">${a.status.replace('_',' ')}</span></td>
            <td><button class="investigate-btn" data-alertid="${a.id}">Investigate</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  alertsTableEl.querySelectorAll('.investigate-btn').forEach(btn => {
    btn.addEventListener('click', () => openAlertDrawer(btn.dataset.alertid));
  });
}

function openTxDrawer(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;
  const alert = state.alerts.find(a => a.txId === txId);
  renderDrawer(tx, alert);
}

function openAlertDrawer(alertId) {
  const alert = state.alerts.find(a => a.id === alertId);
  const tx = state.transactions.find(t => t.id === alert?.txId);
  renderDrawer(tx, alert);
}

function renderDrawer(tx, alert) {
  if (!tx) return;
  drawerContent.innerHTML = `
    <h2>${tx.senderName} \u2192 ${tx.receiverName}</h2>
    <div class="drawer-sub">${timeStr(tx.timestamp)} \u00b7 ${tx.id}</div>

    <div class="kv"><b>Amount</b><span>${money(tx.amount)}</span></div>
    <div class="kv"><b>Status</b><span>${tx.status.replace('_',' ')}</span></div>
    <div class="kv"><b>Risk score</b><span>${tx.risk.score}/100 (${tx.risk.tier})</span></div>
    <div class="kv"><b>z-score</b><span>${tx.risk.zScore}</span></div>
    <div class="kv"><b>Device</b><span>${tx.deviceId}</span></div>
    <div class="kv"><b>Location</b><span>${tx.geo}</span></div>
    <div class="kv"><b>Note</b><span>${tx.note || '\u2014'}</span></div>

    <div style="margin-top:12px;">
      ${tx.risk.triggeredRules.length
        ? tx.risk.triggeredRules.map(r => `<span class="rule-chip">${r.label}</span>`).join('')
        : '<span class="rule-chip">No anomaly rules triggered</span>'}
    </div>

    <div class="explain-box">${tx.risk.explanation}</div>

    ${alert ? `
      <textarea id="analystNote" placeholder="Analyst notes\u2026">${alert.analystNote || ''}</textarea>
      <div class="action-row">
        <button class="action-btn investigating" data-status="investigating">Mark investigating</button>
        <button class="action-btn confirm" data-status="confirmed_fraud">Confirm fraud</button>
        <button class="action-btn dismiss" data-status="false_positive">False positive</button>
      </div>
    ` : `<div class="empty-note" style="margin-top:14px;">This transaction never crossed the alert threshold.</div>`}
  `;

  if (alert) {
    drawerContent.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const note = document.getElementById('analystNote').value;
        await fetch(`${API}/api/alerts/${alert.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: btn.dataset.status, note })
        });
        closeDrawer();
      });
    });
  }

  drawer.classList.remove('hidden');
}

function closeDrawer() { drawer.classList.add('hidden'); }
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset all demo data (users, transactions, alerts)?')) return;
  await fetch(API + '/api/reset', { method: 'POST' });
});

socket.on('connect', () => { connDot.classList.add('live'); connText.textContent = 'live'; });
socket.on('disconnect', () => { connDot.classList.remove('live'); connText.textContent = 'disconnected'; });
socket.on('state', (s) => { state = s; render(); });

render();
