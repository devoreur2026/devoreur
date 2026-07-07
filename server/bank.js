// Domain money operations, each atomic + idempotent, built on the ledger and
// the shared economy rules. This is the ONLY place gameplay touches money.
import {
  CREDIT, EARNINGS, HOLD, STAKE, HOUSE, MINT, GATEWAY, POT, STAKE_PER_LIFE,
  FIREBALL_PACK, FIREBALL_PACK_PRICE,
  splitFireballKill, splitEaterKill, splitForfeit, winnerPayout
} from '../shared/economy.js';
import { Ledger } from './ledger.js';

export class Bank {
  constructor(ledger){ this.ledger = ledger || new Ledger(); this.rolled = {}; }

  wallet(account){ return this.ledger.wallet(account); }
  fireballs(account){ return this.ledger.fireballs(account); }
  history(account, limit){ return this.ledger.history(account, limit); }
  potBalance(roundId){ return this.ledger.balance(POT(roundId), CREDIT); }
  houseBalance(){ return this.ledger.balance(HOUSE, CREDIT); }
  stakeBalance(account){ return this.ledger.balance(account, STAKE); }
  lives(account){ return Math.floor(this.stakeBalance(account) / STAKE_PER_LIFE); }
  auditRound(roundId){ return this.ledger.auditRound(roundId); }
  // net coin change for an account within a round (for the summary screen)
  roundNet(account, roundId){
    var net = 0, rows = this.ledger.rows;
    for (var i = 0; i < rows.length; i++) if (rows[i].round === roundId && rows[i].account === account) net += rows[i].amount;
    return net;
  }
  _meta(m){ m = m || {}; m.ts = Date.now(); return m; }

  // dev-only: mint test Credit into an account (gated by the caller)
  grant(account, amount, idem){
    amount = amount | 0;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, wallet: this.wallet(account) };
    if (amount <= 0) return { ok: false, reason: 'invalid' };
    this.ledger.post(idem, [
      { account: account, bucket: CREDIT, amount: amount, type: 'grant' },
      { account: MINT, bucket: CREDIT, amount: -amount, type: 'grant' }
    ], this._meta({ counterparty: MINT }));
    return { ok: true, wallet: this.wallet(account) };
  }

  // Entry: the price is HELD as stake (lives), not split. Each death spends 250
  // of it; leftover forfeits to the pot at round end. Idempotent per (round,
  // account) so reconnecting to the same round doesn't re-charge. lives = price/250.
  enterRound(account, roundId, price){
    price = price | 0;
    var idem = 'entry:' + roundId + ':' + account;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, stake: this.stakeBalance(account) };
    if (price <= 0) return { ok: false, reason: 'invalid' };
    if (this.wallet(account).credit < price) return { ok: false, reason: 'insufficient', price: price };
    this.ledger.post(idem, [
      { account: account, bucket: CREDIT, amount: -price, type: 'entry' },
      { account: account, bucket: STAKE, amount: price, type: 'entry_stake' }
    ], this._meta({ round: roundId, counterparty: account }));
    return { ok: true, price: price, stake: this.stakeBalance(account) };
  }

  // Buy another life-pack when out of lives (a fresh, non-idempotent purchase).
  buyLives(account, roundId, price, nonce){
    price = price | 0;
    var idem = 'buylives:' + roundId + ':' + account + ':' + nonce;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, stake: this.stakeBalance(account) };
    if (price <= 0) return { ok: false, reason: 'invalid' };
    if (this.wallet(account).credit < price) return { ok: false, reason: 'insufficient', price: price };
    this.ledger.post(idem, [
      { account: account, bucket: CREDIT, amount: -price, type: 'buylives' },
      { account: account, bucket: STAKE, amount: price, type: 'buylives_stake' }
    ], this._meta({ round: roundId, counterparty: account }));
    return { ok: true, price: price, stake: this.stakeBalance(account) };
  }

  // Forfeit an account's remaining stake at round end: 50% house, 50% pot. Idempotent.
  forfeitStake(account, roundId){
    var idem = 'forfeit:' + roundId + ':' + account;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    var s = this.stakeBalance(account);
    if (s <= 0) return { ok: true, empty: true };
    var f = splitForfeit(s);
    this.ledger.post(idem, [
      { account: account, bucket: STAKE, amount: -s, type: 'forfeit' },
      { account: HOUSE, bucket: CREDIT, amount: f.house, type: 'forfeit_house' },
      { account: POT(roundId), bucket: CREDIT, amount: f.pot, type: 'forfeit_pot' }
    ], this._meta({ round: roundId, counterparty: POT(roundId) }));
    return { ok: true, forfeited: s, toHouse: f.house, toPot: f.pot };
  }

  // Safety net against a server restart abandoning an in-flight round (its
  // in-memory state is lost, so endRound never runs). At the start of every round
  // we absorb any money stranded in dead rounds INTO the live round, so no entry
  // is ever lost: orphaned STAKE forfeits 50/50 house/pot; a dead round's leftover
  // POT rolls in whole. A healthy ledger has none of these, so this is usually a
  // no-op. Every posting nets to zero, so audits/integrity are preserved.
  sweepOrphans(roundId, keep){
    keep = keep || new Set();          // accounts currently in the room — their stake is live, don't sweep it
    var here = POT(roundId), stakeAccts = [], deadPots = [];
    for (var [k, v] of this.ledger.bal){
      if (v <= 0) continue;
      var sep = k.lastIndexOf('|'), acc = k.slice(0, sep), bucket = k.slice(sep + 1);
      if (bucket === STAKE && !keep.has(acc)) stakeAccts.push(acc);
      else if (bucket === CREDIT && acc.indexOf('pot:') === 0 && acc !== here) deadPots.push(acc);
    }
    var swept = 0;
    for (var i = 0; i < stakeAccts.length; i++){
      var a = stakeAccts[i], sIdem = 'sweep:' + roundId + ':' + a;
      if (this.ledger.has(sIdem)) continue;
      var s = this.stakeBalance(a);
      if (s <= 0) continue;
      var f = splitForfeit(s);
      this.ledger.post(sIdem, [
        { account: a, bucket: STAKE, amount: -s, type: 'sweep_stake' },
        { account: HOUSE, bucket: CREDIT, amount: f.house, type: 'sweep_house' },
        { account: here, bucket: CREDIT, amount: f.pot, type: 'sweep_pot' }
      ], this._meta({ round: roundId, counterparty: here }));
      swept += s;
    }
    for (var j = 0; j < deadPots.length; j++){
      var pAcc = deadPots[j], pIdem = 'sweeppot:' + roundId + ':' + pAcc;
      if (this.ledger.has(pIdem)) continue;
      var pv = this.ledger.balance(pAcc, CREDIT);
      if (pv <= 0) continue;
      this.ledger.post(pIdem, [
        { account: pAcc, bucket: CREDIT, amount: -pv, type: 'sweep_deadpot' },
        { account: here, bucket: CREDIT, amount: pv, type: 'sweep_potin' }
      ], this._meta({ round: roundId, counterparty: here }));
      swept += pv;
    }
    return swept;
  }

  // Roll an unclaimed pot into the next round (no house cut). Both legs are
  // tagged to the NEW round so both rounds' audits still net to zero:
  //   old round: entries/kills already summed to 0 (rollover isn't tagged to it)
  //   new round: (potOld -P) + (potNew +P) = 0, plus its own 0-sum txns.
  rollover(fromRound, toRound){
    var idem = 'rollover:' + toRound;
    if (this.ledger.has(idem)) return this.rolled[toRound] || 0;
    var P = this.potBalance(fromRound);
    if (P <= 0){ this.rolled[toRound] = 0; return 0; }
    this.ledger.post(idem, [
      { account: POT(fromRound), bucket: CREDIT, amount: -P, type: 'rollover_out' },
      { account: POT(toRound), bucket: CREDIT, amount: P, type: 'rollover_in' }
    ], this._meta({ round: toRound, counterparty: 'rollover' }));
    this.rolled[toRound] = P;
    return P;
  }

  // abort: exactly reverse every row of the round -> everyone made whole, audit stays 0
  abortRound(roundId){
    var idem = 'abort:' + roundId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    var deltas = [];
    for (var i = 0; i < this.ledger.rows.length; i++){
      var r = this.ledger.rows[i];
      // Refund this round's entries + kills, but DON'T reverse a carried-over pot
      // (rollover). Reversing it would strand that money in the dead source round;
      // leaving it lets newRound roll it forward, conserving the pot.
      if (r.round === roundId && r.type !== 'rollover_in' && r.type !== 'rollover_out')
        deltas.push({ account: r.account, bucket: r.bucket, amount: -r.amount, type: 'refund' });
    }
    if (!deltas.length) return { ok: true, empty: true };
    this.ledger.post(idem, deltas, this._meta({ round: roundId, counterparty: 'abort' }));
    return { ok: true, reversed: deltas.length };
  }

  // death by a fireball spends one life (250) of the victim's STAKE: 70% -> killer
  // EARNINGS, 30% -> pot. (A living victim always has >= 250 staked.)
  killByFireball(victim, killer, roundId, killId){
    var idem = 'kill:' + killId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, taken: 0 };
    var taken = Math.min(STAKE_PER_LIFE, this.stakeBalance(victim));
    if (taken === 0){ this.ledger.post(idem, [], this._meta({ round: roundId, counterparty: killer })); return { ok: true, taken: 0 }; }
    var s = splitFireballKill(taken);
    this.ledger.post(idem, [
      { account: victim, bucket: STAKE, amount: -taken, type: 'kill_pvp' },
      { account: killer, bucket: EARNINGS, amount: s.killer, type: 'kill_reward' },
      { account: POT(roundId), bucket: CREDIT, amount: s.pot, type: 'kill_pot' }
    ], this._meta({ round: roundId, counterparty: killer }));
    return { ok: true, taken: taken, toKiller: s.killer, toPot: s.pot };
  }

  // death by an eater spends one life (250) of the STAKE: 50% house, 50% pot
  killByEater(victim, roundId, killId){
    var idem = 'kill:' + killId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, taken: 0 };
    var taken = Math.min(STAKE_PER_LIFE, this.stakeBalance(victim));
    if (taken === 0){ this.ledger.post(idem, [], this._meta({ round: roundId, counterparty: HOUSE })); return { ok: true, taken: 0 }; }
    var s = splitEaterKill(taken);
    this.ledger.post(idem, [
      { account: victim, bucket: STAKE, amount: -taken, type: 'kill_eater' },
      { account: HOUSE, bucket: CREDIT, amount: s.house, type: 'kill_house' },
      { account: POT(roundId), bucket: CREDIT, amount: s.pot, type: 'kill_pot' }
    ], this._meta({ round: roundId, counterparty: HOUSE }));
    return { ok: true, taken: taken, toHouse: s.house, toPot: s.pot };
  }

  // winner claims the pot, guaranteed at least BONUS_POT every round (house tops up)
  payout(winner, roundId, paidPlayers){
    var idem = 'payout:' + roundId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    var pot = this.potBalance(roundId);
    var target = winnerPayout(pot, paidPlayers);
    var topup = target - pot;
    if (target === 0) return { ok: true, pot: 0, target: 0, topup: 0 };
    var deltas = [
      { account: winner, bucket: EARNINGS, amount: target, type: 'payout' },
      { account: POT(roundId), bucket: CREDIT, amount: -pot, type: 'payout_pot' }
    ];
    if (topup > 0) deltas.push({ account: HOUSE, bucket: CREDIT, amount: -topup, type: 'payout_topup' });
    this.ledger.post(idem, deltas, this._meta({ round: roundId, counterparty: winner }));
    return { ok: true, pot: pot, target: target, topup: topup };
  }

  // shop: buy `packs` packs of fireballs from Credit (revenue to house)
  buyFireballs(account, packs, nonce){
    packs = Math.max(1, packs | 0);
    var idem = 'shop:' + account + ':' + nonce;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, fireballs: this.fireballs(account) };
    var cost = packs * FIREBALL_PACK_PRICE;
    if (this.wallet(account).credit < cost) return { ok: false, reason: 'insufficient' };
    this.ledger.post(idem, [
      { account: account, bucket: CREDIT, amount: -cost, type: 'shop' },
      { account: HOUSE, bucket: CREDIT, amount: cost, type: 'shop_revenue' }
    ], this._meta({ counterparty: HOUSE }), [{ account: account, fireballs: packs * FIREBALL_PACK }]);
    return { ok: true, fireballs: this.fireballs(account), cost: cost };
  }

  // consume one fireball for a throw (idempotent per throwId)
  consumeFireball(account, throwId){
    var idem = 'fb:' + throwId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    if (this.fireballs(account) <= 0) return { ok: false, reason: 'empty' };
    this.ledger.post(idem, [], this._meta({ counterparty: 'throw' }), [{ account: account, fireballs: -1 }]);
    return { ok: true, fireballs: this.fireballs(account) };
  }

  // free, instant Earnings -> Credit transfer
  transfer(account, amount, nonce){
    amount = amount | 0;
    var idem = 'xfer:' + account + ':' + nonce;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, wallet: this.wallet(account) };
    if (amount <= 0) return { ok: false, reason: 'invalid' };
    if (this.wallet(account).earnings < amount) return { ok: false, reason: 'insufficient' };
    this.ledger.post(idem, [
      { account: account, bucket: EARNINGS, amount: -amount, type: 'transfer_out' },
      { account: account, bucket: CREDIT, amount: amount, type: 'transfer_in' }
    ], this._meta({ counterparty: account }));
    return { ok: true, wallet: this.wallet(account) };
  }

  /* ---------- real-money payments (gateway) ----------
     Every leg is a balanced double-entry against the external GATEWAY account,
     idempotent per order_id, so a retried callback or status poll can never
     double-credit / double-charge. NONE of these are called from client input;
     only from a signature-verified callback or a status poll reporting success. */

  held(account){ return this.ledger.balance(account, HOLD); }
  gatewayBalance(){ return this.ledger.balance(GATEWAY, CREDIT); }

  // DEPOSIT success: real money in -> player Credit. Called ONCE per order, only
  // after a verified success. Idempotent on order_id.
  creditDeposit(account, amount, orderId){
    amount = amount | 0;
    var idem = 'dep:' + orderId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, wallet: this.wallet(account) };
    if (amount <= 0) return { ok: false, reason: 'invalid' };
    this.ledger.post(idem, [
      { account: GATEWAY, bucket: CREDIT, amount: -amount, type: 'deposit' },
      { account: account, bucket: CREDIT, amount: amount, type: 'deposit' }
    ], this._meta({ counterparty: GATEWAY }));
    return { ok: true, wallet: this.wallet(account) };
  }

  // WITHDRAWAL step 1 — move Earnings -> hold IMMEDIATELY (atomic; prevents
  // double-spend while the payout is in flight). Idempotent on order_id.
  holdWithdrawal(account, amount, orderId){
    amount = amount | 0;
    var idem = 'wdhold:' + orderId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, wallet: this.wallet(account) };
    if (amount <= 0) return { ok: false, reason: 'invalid' };
    if (this.wallet(account).earnings < amount) return { ok: false, reason: 'insufficient' };
    this.ledger.post(idem, [
      { account: account, bucket: EARNINGS, amount: -amount, type: 'wd_hold' },
      { account: account, bucket: HOLD, amount: amount, type: 'wd_hold' }
    ], this._meta({ counterparty: GATEWAY }));
    return { ok: true, wallet: this.wallet(account), held: this.held(account) };
  }

  // WITHDRAWAL success -> money leaves the system (hold -> gateway out).
  completeWithdrawal(account, amount, orderId){
    amount = amount | 0;
    var idem = 'wddone:' + orderId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    this.ledger.post(idem, [
      { account: account, bucket: HOLD, amount: -amount, type: 'wd_paid' },
      { account: GATEWAY, bucket: CREDIT, amount: amount, type: 'wd_paid' }
    ], this._meta({ counterparty: GATEWAY }));
    return { ok: true, wallet: this.wallet(account) };
  }

  // WITHDRAWAL failed/cancelled -> release the hold back to Earnings. Mutually
  // exclusive with completeWithdrawal (the hold only holds `amount` once, so the
  // ledger floor rejects doing both — defense in depth beyond the state machine).
  releaseWithdrawal(account, amount, orderId){
    amount = amount | 0;
    var idem = 'wdrel:' + orderId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    this.ledger.post(idem, [
      { account: account, bucket: HOLD, amount: -amount, type: 'wd_release' },
      { account: account, bucket: EARNINGS, amount: amount, type: 'wd_release' }
    ], this._meta({ counterparty: GATEWAY }));
    return { ok: true, wallet: this.wallet(account) };
  }
}
