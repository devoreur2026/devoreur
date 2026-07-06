// Append-only, double-entry, idempotent ledger — the money-safety core.
//
// Every mutation is a single `post(txId, deltas, ...)` where the deltas sum to
// exactly zero (money is conserved). Applying is synchronous, so on a single-
// threaded server two events in the same tick can never interleave. `txId` is an
// idempotency key: replaying the same transaction (double-click, reconnect
// retry) is a no-op that returns the original result — no double-spend. Balances
// are only ever changed here, alongside the matching append-only row, so the
// invariant "balance == sum of that account's row deltas" holds by construction.
import { HOUSE, MINT, GATEWAY, CREDIT, EARNINGS } from '../shared/economy.js';

// Only these accounts may go negative (they represent the operator / external
// money). Players and pots can never go below zero.
function mayGoNegative(account){ return account === HOUSE || account === MINT || account === GATEWAY; }

export class Ledger {
  constructor(){
    this.bal = new Map();        // "account|bucket" -> integer coins
    this.rows = [];              // append-only
    this.applied = new Map();    // txId -> result (idempotency)
    this.inv = new Map();        // account -> fireballs (integer)
    this.nextId = 1;
    this.sink = null;            // optional fn(rows) for durable write-through
    this.invSink = null;         // optional fn(account, count) for inventory durability
  }

  key(a, b){ return a + '|' + b; }
  balance(account, bucket){ return this.bal.get(this.key(account, bucket)) || 0; }
  wallet(account){ return { credit: this.balance(account, CREDIT), earnings: this.balance(account, EARNINGS) }; }
  fireballs(account){ return this.inv.get(account) || 0; }
  has(txId){ return this.applied.has(txId); }

  // Post a balanced set of deltas atomically + idempotently.
  //   deltas   : [{ account, bucket, amount, type }]  (sum of amount === 0)
  //   meta     : { round, counterparty }
  //   invDeltas: [{ account, fireballs }]  applied atomically with the money
  post(txId, deltas, meta, invDeltas){
    if (this.applied.has(txId)) return this.applied.get(txId);   // idempotent replay
    meta = meta || {};

    var sum = 0, i;
    for (i = 0; i < deltas.length; i++){
      if (!Number.isInteger(deltas[i].amount)) throw new Error('ledger: non-integer amount in ' + txId);
      sum += deltas[i].amount;
    }
    if (sum !== 0) throw new Error('ledger: unbalanced transaction ' + txId + ' (sum ' + sum + ')');

    // validate floors on the NET effect per account|bucket BEFORE mutating
    // (all-or-nothing). Checking each delta against the live balance would wrongly
    // reject a transaction that nets to >= 0 but passes through a transient
    // negative (e.g. an abort that reverses an entry then re-credits a kill).
    var net = new Map();   // "account|bucket" -> { account, amount }
    for (i = 0; i < deltas.length; i++){
      var d = deltas[i], nk = this.key(d.account, d.bucket), ne = net.get(nk);
      if (ne) ne.amount += d.amount; else net.set(nk, { account: d.account, amount: d.amount });
    }
    for (var [fk, fe] of net){
      var after = (this.bal.get(fk) || 0) + fe.amount;
      if (after < 0 && !mayGoNegative(fe.account))
        throw new Error('ledger: ' + fk + ' would go negative (' + after + ') in ' + txId);
    }
    invDeltas = invDeltas || [];
    for (i = 0; i < invDeltas.length; i++){
      if ((this.fireballs(invDeltas[i].account) + invDeltas[i].fireballs) < 0)
        throw new Error('ledger: inventory would go negative in ' + txId);
    }

    // apply money
    var appended = [];
    for (i = 0; i < deltas.length; i++){
      var e = deltas[i], k = this.key(e.account, e.bucket);
      var bal = (this.bal.get(k) || 0) + e.amount;
      this.bal.set(k, bal);
      var row = {
        id: this.nextId++, ts: meta.ts || null, tx: txId,
        account: e.account, bucket: e.bucket, type: e.type || meta.type || 'move',
        amount: e.amount, balanceAfter: bal,
        round: meta.round || null, counterparty: meta.counterparty || null
      };
      this.rows.push(row); appended.push(row);
    }
    // apply inventory
    for (i = 0; i < invDeltas.length; i++){
      var a = invDeltas[i];
      this.inv.set(a.account, this.fireballs(a.account) + a.fireballs);
      if (this.invSink){ try { this.invSink(a.account, this.inv.get(a.account)); } catch (err) { console.error('[inv sink]', err); } }
    }

    var result = { ok: true, rows: appended };
    this.applied.set(txId, result);
    if (this.sink){ try { this.sink(appended); } catch (err) { console.error('[ledger sink]', err); } }
    return result;
  }

  // most-recent-first ledger rows for an account (both buckets) — for the wallet UI
  history(account, limit){
    var out = [];
    for (var i = this.rows.length - 1; i >= 0 && out.length < (limit || 50); i--){
      if (this.rows[i].account === account) out.push(this.rows[i]);
    }
    return out;
  }

  // audit: the signed deltas of a round must net to exactly zero
  auditRound(roundId){
    var sum = 0;
    for (var i = 0; i < this.rows.length; i++) if (this.rows[i].round === roundId) sum += this.rows[i].amount;
    return sum;
  }

  // integrity: recompute balances from rows and confirm they match (tests)
  verifyIntegrity(){
    var recomputed = new Map();
    for (var i = 0; i < this.rows.length; i++){
      var r = this.rows[i], k = this.key(r.account, r.bucket);
      recomputed.set(k, (recomputed.get(k) || 0) + r.amount);
    }
    for (var [k, v] of this.bal){ if ((recomputed.get(k) || 0) !== v) return false; }
    for (var [k2, v2] of recomputed){ if ((this.bal.get(k2) || 0) !== v2) return false; }
    return true;
  }
}
