// Domain money operations, each atomic + idempotent, built on the ledger and
// the shared economy rules. This is the ONLY place gameplay touches money.
import {
  CREDIT, EARNINGS, HOUSE, MINT, POT,
  ENTRY_FEE, FIREBALL_PACK, FIREBALL_PACK_PRICE,
  splitEntry, killTaken, splitFireballKill, splitEaterKill, winnerPayout
} from '../shared/economy.js';
import { Ledger } from './ledger.js';

export class Bank {
  constructor(ledger){ this.ledger = ledger || new Ledger(); }

  wallet(account){ return this.ledger.wallet(account); }
  fireballs(account){ return this.ledger.fireballs(account); }
  history(account, limit){ return this.ledger.history(account, limit); }
  potBalance(roundId){ return this.ledger.balance(POT(roundId), CREDIT); }
  houseBalance(){ return this.ledger.balance(HOUSE, CREDIT); }
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

  // charge the entry fee: 30% house rake, 70% to the round pot
  enterRound(account, roundId){
    var idem = 'entry:' + roundId + ':' + account;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, pot: this.potBalance(roundId) };
    if (this.wallet(account).credit < ENTRY_FEE) return { ok: false, reason: 'insufficient' };
    var s = splitEntry(ENTRY_FEE);
    this.ledger.post(idem, [
      { account: account, bucket: CREDIT, amount: -ENTRY_FEE, type: 'entry' },
      { account: HOUSE, bucket: CREDIT, amount: s.house, type: 'rake' },
      { account: POT(roundId), bucket: CREDIT, amount: s.pot, type: 'entry_pot' }
    ], this._meta({ round: roundId, counterparty: POT(roundId) }));
    return { ok: true, pot: this.potBalance(roundId) };
  }

  // abort: exactly reverse every row of the round -> everyone made whole, audit stays 0
  abortRound(roundId){
    var idem = 'abort:' + roundId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true };
    var deltas = [];
    for (var i = 0; i < this.ledger.rows.length; i++){
      var r = this.ledger.rows[i];
      if (r.round === roundId) deltas.push({ account: r.account, bucket: r.bucket, amount: -r.amount, type: 'refund' });
    }
    if (!deltas.length) return { ok: true, empty: true };
    this.ledger.post(idem, deltas, this._meta({ round: roundId, counterparty: 'abort' }));
    return { ok: true, reversed: deltas.length };
  }

  // victim loses up to KILL_PENALTY from Credit; killer's EARNINGS + pot split
  killByFireball(victim, killer, roundId, killId){
    var idem = 'kill:' + killId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, taken: 0 };
    var taken = killTaken(this.wallet(victim).credit);
    if (taken === 0){ this.ledger.post(idem, [], this._meta({ round: roundId, counterparty: killer })); return { ok: true, taken: 0 }; }
    var s = splitFireballKill(taken);
    this.ledger.post(idem, [
      { account: victim, bucket: CREDIT, amount: -taken, type: 'kill_pvp' },
      { account: killer, bucket: EARNINGS, amount: s.killer, type: 'kill_reward' },
      { account: POT(roundId), bucket: CREDIT, amount: s.pot, type: 'kill_pot' }
    ], this._meta({ round: roundId, counterparty: killer }));
    return { ok: true, taken: taken, toKiller: s.killer, toPot: s.pot };
  }

  // eater kill: 50% house, 50% pot
  killByEater(victim, roundId, killId){
    var idem = 'kill:' + killId;
    if (this.ledger.has(idem)) return { ok: true, idempotent: true, taken: 0 };
    var taken = killTaken(this.wallet(victim).credit);
    if (taken === 0){ this.ledger.post(idem, [], this._meta({ round: roundId, counterparty: HOUSE })); return { ok: true, taken: 0 }; }
    var s = splitEaterKill(taken);
    this.ledger.post(idem, [
      { account: victim, bucket: CREDIT, amount: -taken, type: 'kill_eater' },
      { account: HOUSE, bucket: CREDIT, amount: s.house, type: 'kill_house' },
      { account: POT(roundId), bucket: CREDIT, amount: s.pot, type: 'kill_pot' }
    ], this._meta({ round: roundId, counterparty: HOUSE }));
    return { ok: true, taken: taken, toHouse: s.house, toPot: s.pot };
  }

  // winner claims the pot; 5+ paid players guarantees BONUS_POT (house tops up)
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
}
