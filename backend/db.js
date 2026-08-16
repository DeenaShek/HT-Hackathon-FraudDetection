// db.js — tiny zero-dependency JSON-file datastore.
// Not "production" but perfect for a hackathon demo: no native builds,
// human-readable, and survives a server restart.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'store.json');

function seed() {
  const now = Date.now();
  return {
    users: [
      { id: 'u_dakshanya', name: 'Dakshanya', handle: '@dakshanya', balance: 52000, type: 'sender' },
      { id: 'u_ramesh',    name: 'Ramesh Kumar', handle: '@ramesh',  balance: 18000, type: 'both' },
      { id: 'u_priya',     name: 'Priya Sharma', handle: '@priya',   balance: 9000,  type: 'both' },
      { id: 'u_arjun',     name: 'Arjun Vel',   handle: '@arjun',    balance: 4000,  type: 'both' },
      { id: 'u_mystore',   name: 'QuickMart Merchant', handle: '@quickmart', balance: 250000, type: 'receiver' },
      { id: 'u_ghost',     name: 'Unknown Wallet 9182', handle: '@unk9182', balance: 500, type: 'receiver' }
    ],
    transactions: [],
    alerts: [],
    meta: { createdAt: now }
  };
}

function load() {
  if (!fs.existsSync(FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(seed(), null, 2));
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function reset() {
  fs.writeFileSync(FILE, JSON.stringify(seed(), null, 2));
  return load();
}

module.exports = { load, save, reset };
