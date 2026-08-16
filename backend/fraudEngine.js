// fraudEngine.js
// Scores a transaction 0-100 using:
//   (1) a rule bank (velocity, structuring, mule/pass-through, odd-hour, etc.)
//   (2) a lightweight statistical anomaly model (rolling z-score per sender —
//       stands in for an Isolation Forest / autoencoder without needing a
//       training pipeline for a demo)
// and produces a plain-English explanation of *why* a score was given —
// this function is the seam to swap in a real LLM call later (see README).

const RULES = {
  VELOCITY:        { weight: 30, label: 'High transaction velocity' },
  AMOUNT_ANOMALY:  { weight: 25, label: 'Amount far outside sender\u2019s normal range' },
  NEW_RECEIVER_BIG:{ weight: 20, label: 'First-time transfer to this receiver, unusually large' },
  ODD_HOUR:        { weight: 10, label: 'Transaction at an unusual hour' },
  STRUCTURING:     { weight: 18, label: 'Amount just under a common reporting threshold (structuring pattern)' },
  MULE_PASSTHROUGH:{ weight: 28, label: 'Receiver forwarded funds within seconds of receiving them (mule pattern)' },
  DEVICE_HOPPING:  { weight: 15, label: 'Sender switched device/location right before this transaction' },
  CIRCULAR_FLOW:   { weight: 22, label: 'Circular transaction: funds returning toward the original sender' }
};

const THRESHOLDS = [1000, 2000, 5000, 10000, 49999, 50000, 100000, 200000];

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / (arr.length || 1); }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
}

/**
 * @param {object} tx - candidate transaction {senderId, receiverId, amount, deviceId, geo, timestamp}
 * @param {object[]} history - all prior transactions (most recent last)
 */
function scoreTransaction(tx, history) {
  const triggered = [];
  const now = tx.timestamp;

  const senderHistory = history.filter(h => h.senderId === tx.senderId);
  const senderAmounts = senderHistory.map(h => h.amount);

  // 1. VELOCITY — 3+ txns from this sender in the last 60s
  const lastMinute = senderHistory.filter(h => now - h.timestamp <= 60 * 1000);
  if (lastMinute.length >= 2) triggered.push('VELOCITY');

  // 2. AMOUNT ANOMALY — z-score vs sender's own rolling history
  let zScore = 0;
  if (senderAmounts.length >= 3) {
    const m = mean(senderAmounts);
    const sd = stddev(senderAmounts) || 1;
    zScore = (tx.amount - m) / sd;
    if (zScore > 2.2) triggered.push('AMOUNT_ANOMALY');
  } else if (senderAmounts.length === 0 && tx.amount > 20000) {
    // no history at all + a big first transaction is itself notable
    triggered.push('AMOUNT_ANOMALY');
  }

  // 3. NEW RECEIVER + BIG AMOUNT
  const seenReceiverBefore = senderHistory.some(h => h.receiverId === tx.receiverId);
  if (!seenReceiverBefore && tx.amount >= 15000) triggered.push('NEW_RECEIVER_BIG');

  // 4. ODD HOUR (11pm - 5am local demo clock)
  const hour = new Date(now).getHours();
  if (hour >= 23 || hour < 5) triggered.push('ODD_HOUR');

  // 5. STRUCTURING — amount sits just under a round reporting threshold
  if (THRESHOLDS.some(t => tx.amount >= t - 500 && tx.amount < t)) {
    triggered.push('STRUCTURING');
  }

  // 6. MULE / PASS-THROUGH — receiver of THIS tx sent most of it onward within 90s
  //    of receiving a prior inbound transaction
  const receiverInbound = history.filter(h => h.receiverId === tx.senderId);
  const recentInbound = receiverInbound.filter(h => now - h.timestamp <= 90 * 1000);
  if (recentInbound.length > 0) {
    const inboundTotal = recentInbound.reduce((s, h) => s + h.amount, 0);
    if (tx.amount >= inboundTotal * 0.85) triggered.push('MULE_PASSTHROUGH');
  }

  // 7. DEVICE / LOCATION HOPPING — sender's device or geo differs from their last txn
  const lastSenderTx = [...senderHistory].reverse()[0];
  if (lastSenderTx && (lastSenderTx.deviceId !== tx.deviceId || lastSenderTx.geo !== tx.geo)) {
    const gapMs = now - lastSenderTx.timestamp;
    if (gapMs <= 5 * 60 * 1000) triggered.push('DEVICE_HOPPING');
  }

  // 8. CIRCULAR FLOW — receiver has, within the last few txns, sent money that
  //    eventually routes back to tx.senderId (2-hop loop: A->B, now B->A)
  const loopBack = history.some(h =>
    h.senderId === tx.receiverId &&
    h.receiverId === tx.senderId &&
    now - h.timestamp <= 10 * 60 * 1000
  );
  if (loopBack) triggered.push('CIRCULAR_FLOW');

  // --- combine into a 0-100 score ---
  let raw = triggered.reduce((s, key) => s + RULES[key].weight, 0);
  // statistical bump from z-score, capped
  raw += Math.max(0, Math.min(20, zScore * 5));
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const tier =
    score >= 80 ? 'CRITICAL' :
    score >= 60 ? 'HIGH' :
    score >= 30 ? 'MEDIUM' : 'LOW';

  return {
    score,
    tier,
    triggeredRules: triggered.map(key => ({ key, ...RULES[key] })),
    zScore: Number(zScore.toFixed(2)),
    explanation: buildExplanation(tx, triggered, zScore, score)
  };
}

// Template-based explanation generator. This is the exact seam where you'd
// swap in a real LLM call (see README "Upgrading to a live LLM") — just
// replace the return of this function with an API response, feeding it the
// same (tx, triggered, zScore, score) context.
function buildExplanation(tx, triggered, zScore, score) {
  if (triggered.length === 0) {
    return `Transaction of \u20b9${tx.amount.toLocaleString('en-IN')} looks consistent with the sender's normal behavior. No anomaly rules triggered.`;
  }
  const reasons = triggered.map(key => RULES[key].label.toLowerCase());
  const list = reasons.length === 1
    ? reasons[0]
    : reasons.slice(0, -1).join(', ') + ' and ' + reasons[reasons.length - 1];
  let verdict = score >= 80 ? 'This transaction should be held for manual review before settling.' :
                score >= 60 ? 'This transaction warrants investigation.' :
                score >= 30 ? 'This transaction is worth a light second look.' :
                'No action needed.';
  return `Flagged for: ${list}. ${verdict}`;
}

module.exports = { scoreTransaction, RULES };
