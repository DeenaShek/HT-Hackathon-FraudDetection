const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { load, save, reset } = require('./db');
const { scoreTransaction } = require('./fraudEngine');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let db = load();

// ---------- helpers ----------
function broadcast() {
  io.emit('state', { transactions: db.transactions, alerts: db.alerts, users: db.users });
}

const ALERT_THRESHOLD = 50; // score at/above this creates an alert

// ---------- REST API ----------

app.get('/api/users', (req, res) => res.json(db.users));

app.get('/api/state', (req, res) => {
  res.json({ transactions: db.transactions, alerts: db.alerts, users: db.users });
});

// Sender app calls this to send money
app.post('/api/transactions', (req, res) => {
  const { senderId, receiverId, amount, note, deviceId, geo } = req.body;
  const sender = db.users.find(u => u.id === senderId);
  const receiver = db.users.find(u => u.id === receiverId);
  if (!sender || !receiver) return res.status(400).json({ error: 'Unknown sender or receiver' });
  if (senderId === receiverId) return res.status(400).json({ error: 'Cannot send to yourself' });
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (sender.balance < amt) return res.status(400).json({ error: 'Insufficient balance' });

  const tx = {
    id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    senderId, receiverId,
    senderName: sender.name, receiverName: receiver.name,
    amount: amt,
    note: note || '',
    deviceId: deviceId || 'device_unknown',
    geo: geo || 'Chennai,IN',
    timestamp: Date.now(),
    status: 'processing'
  };

  const result = scoreTransaction(tx, db.transactions);
  tx.risk = result;

  // Simple friction policy: CRITICAL gets held, everything else settles instantly
  if (result.tier === 'CRITICAL') {
    tx.status = 'held_for_review';
  } else {
    tx.status = 'settled';
    sender.balance -= amt;
    receiver.balance += amt;
  }

  db.transactions.push(tx);

  if (result.score >= ALERT_THRESHOLD) {
    db.alerts.push({
      id: 'al_' + tx.id,
      txId: tx.id,
      createdAt: Date.now(),
      tier: result.tier,
      score: result.score,
      status: 'open', // open | investigating | confirmed_fraud | false_positive
      summary: result.explanation,
      rules: result.triggeredRules.map(r => r.key)
    });
  }

  save(db);
  broadcast();
  res.json({ tx });
});

// Receiver app polls/subscribes via socket, but also expose a REST fallback
app.get('/api/transactions/:userId', (req, res) => {
  const list = db.transactions.filter(t => t.senderId === req.params.userId || t.receiverId === req.params.userId);
  res.json(list);
});

// Dashboard: update an alert's investigation status
app.patch('/api/alerts/:id', (req, res) => {
  const alert = db.alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const { status, note } = req.body;
  if (status) alert.status = status;
  if (note !== undefined) alert.analystNote = note;
  alert.updatedAt = Date.now();

  // If confirmed fraud and the tx had settled, simulate a reversal
  if (status === 'confirmed_fraud') {
    const tx = db.transactions.find(t => t.id === alert.txId);
    if (tx && tx.status === 'settled') {
      const sender = db.users.find(u => u.id === tx.senderId);
      const receiver = db.users.find(u => u.id === tx.receiverId);
      if (sender && receiver && receiver.balance >= tx.amount) {
        receiver.balance -= tx.amount;
        sender.balance += tx.amount;
        tx.status = 'reversed';
      }
    }
  }
  if (status === 'false_positive') {
    const tx = db.transactions.find(t => t.id === alert.txId);
    if (tx && tx.status === 'held_for_review') {
      const sender = db.users.find(u => u.id === tx.senderId);
      const receiver = db.users.find(u => u.id === tx.receiverId);
      sender.balance -= tx.amount;
      receiver.balance += tx.amount;
      tx.status = 'settled';
    }
  }

  save(db);
  broadcast();
  res.json({ alert });
});

app.post('/api/reset', (req, res) => {
  db = reset();
  broadcast();
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.emit('state', { transactions: db.transactions, alerts: db.alerts, users: db.users });
});

// Serve the three static front-ends
app.use('/sender', express.static(__dirname + '/../sender-app'));
app.use('/receiver', express.static(__dirname + '/../receiver-app'));
app.use('/dashboard', express.static(__dirname + '/../dashboard'));
app.get('/', (req, res) => res.redirect('/dashboard'));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Fraud demo backend running on http://localhost:${PORT}`);
  console.log(`  Sender app:    http://localhost:${PORT}/sender`);
  console.log(`  Receiver app:  http://localhost:${PORT}/receiver`);
  console.log(`  Dashboard:     http://localhost:${PORT}/dashboard`);
});
