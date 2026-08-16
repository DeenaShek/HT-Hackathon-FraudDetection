# PayNow + Sentinel — Real-Time Payments Fraud Detection

Three apps, one shared backend:

| App | URL (after starting) | What it is |
|---|---|---|
| **Sender** | http://localhost:4000/sender | GPay-like "send money" screen |
| **Receiver** | http://localhost:4000/receiver | GPay-like wallet that updates live as money arrives |
| **Sentinel dashboard** | http://localhost:4000/dashboard | Fraud ops console: live feed, risk scores, alert queue, investigation drawer |

## Run it

```bash
cd backend
npm install
npm start
```

Then open all three URLs above (in separate tabs, or on separate devices on the
same network by using your machine's LAN IP instead of `localhost`). No `.env`,
no external DB, no API keys needed — it's zero-config on purpose so you can
demo it in the first five minutes of a hackathon slot.

Data lives in `backend/data/store.json` (auto-created on first run). Hit
**"Reset demo data"** in the dashboard sidebar, or `POST /api/reset`, to wipe
it back to the seeded users.

## Seeded identities

Sender-capable: **Dakshanya** (₹52,000). Both sender & receiver: **Ramesh**,
**Priya**, **Arjun**. Receiver-only: **QuickMart Merchant**, **Unknown Wallet
9182** (deliberately named to *feel* suspicious — good for demoing "new,
unfamiliar receiver" flags).

## How scoring works (`backend/fraudEngine.js`)

Every transaction is run through:

1. **A rule bank** (8 rules, each with a weight) — velocity, amount anomaly,
   new-receiver-large-amount, odd-hour, **structuring** (amount just under a
   round reporting threshold, e.g. ₹49,999), **mule/pass-through** (receiver
   forwards funds within 90s of receiving them — classic money-mule
   behavior), device/location hopping, and **circular flow** (A→B→A within
   10 minutes).
2. **A statistical anomaly model** — a rolling z-score of the amount against
   that sender's own transaction history. This stands in for an Isolation
   Forest / autoencoder: same idea (flag deviation from a learned normal),
   without needing a training pipeline for a demo. Swappable for a real
   scikit-learn/TF model later (see below).

Scores combine into 0–100, bucketed into `LOW / MEDIUM / HIGH / CRITICAL`.
`CRITICAL` transactions are **held for review** instead of settling instantly
— the "seconds, not minutes" friction the problem statement asks for.
Anything scoring ≥ 50 also creates an alert in the dashboard's queue.

## Demo script (2 minutes)

1. Open Sender + Receiver + Dashboard side by side.
2. Send ₹500 from Dakshanya to Ramesh — dashboard feed updates instantly,
   LOW risk, receiver wallet balance ticks up with a toast.
3. Send ₹49,999 to "Unknown Wallet 9182" — MEDIUM/HIGH risk (structuring +
   new receiver), alert appears in the queue.
4. Click the sender app's device chip to "switch phones" (simulates a new
   device/geo), then rapid-fire 2–3 more payments — triggers VELOCITY and
   DEVICE_HOPPING, pushes the score into CRITICAL, and the payment is
   **held for review** rather than settling.
5. In the dashboard, click **Investigate** on that alert — the drawer shows
   every rule that fired and the plain-English explanation. Mark it
   **Confirm fraud** (reverses a settled transfer) or **False positive**
   (releases a held one) and watch balances update live everywhere.
6. To show the mule pattern: send money into Arjun's wallet, then
   immediately send most of it back out from Arjun to someone else —
   MULE_PASSTHROUGH fires.

## Upgrading the explanation engine to a real LLM

`fraudEngine.js` has a single function, `buildExplanation(tx, triggeredRules,
zScore, score)`, that currently builds the explanation from a template. To
make it a genuine LLM-generated explanation instead, replace its body with a
call to the Anthropic API, e.g.:

```js
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Explain in one short paragraph, for a fraud analyst, why this
transaction scored ${score}/100 risk. Triggered rules: ${triggeredRules.map(r => r.label).join(', ')}.
Transaction: ₹${tx.amount} from ${tx.senderId} to ${tx.receiverId}.`
    }]
  })
});
const data = await res.json();
return data.content[0].text;
```

You'd need your own `ANTHROPIC_API_KEY` and to make `scoreTransaction` (and
its caller in `server.js`) `async`. Kept out of the default build so the demo
never depends on network access or a live key during judging.

## Architecture

```
sender-app/  ─┐
receiver-app/ ─┼─► POST /api/transactions ─► fraudEngine.scoreTransaction()
dashboard/   ─┘         │                          │
                         ▼                          ▼
                  db.json (transactions,      risk score + rules +
                  alerts, user balances)       explanation attached to tx
                         │
                         ▼
              io.emit('state', {...}) ─► every connected app re-renders live
```

Everything is one Express process (`backend/server.js`) serving the three
static front-ends and a Socket.io channel that broadcasts the full state on
every change — that's the "real-time" in real-time monitoring: no polling
needed anywhere except the initial page load.
