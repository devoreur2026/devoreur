// Payment orchestration: validates requests, drives the gateway, and applies
// money to the ledger through a strictly idempotent state machine. Money is
// ONLY moved here, and ONLY from a verified gateway response / signed callback /
// status poll — never from a client claim.
import { randomUUID } from 'crypto';
import { verifySignature } from './unipesa/sign.js';
import { readStatus, readConfirmType, readMessage } from './unipesa/client.js';
import {
  providerByKey, normalizePhone, STATUS, STATUS_LABEL
} from '../shared/payments.js';

var RECONCILE_AFTER_MS = 5 * 60 * 1000;   // poll anything unsettled older than 5 min

function startOfDayMs(){ var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

export class Payments {
  constructor(opts){ this.bank = opts.bank; this.store = opts.store; this.client = opts.client; this.cfg = opts.config; }

  /* ---- the ONLY place a payment's status turns into money. Idempotent:
       a settled record is a no-op, and the bank ops are idempotent per order. */
  applyStatus(orderId, status, extra){
    var rec = this.store.get(orderId);
    if (!rec) return { ok: false, reason: 'unknown_order' };
    if (rec.settled) return { ok: true, idempotent: true, record: rec };
    extra = extra || {};
    var msg = readMessage(extra);

    if (rec.kind === 'deposit'){
      if (status === STATUS.SUCCESS){
        this.bank.creditDeposit(rec.account, rec.amount, rec.order_id);            // credit ONCE
        this.store.update(orderId, { status: STATUS.SUCCESS, status_label: 'réussi', settled: true, credited: true });
      } else if (status === STATUS.FAILED || status === STATUS.CANCELLED){
        this.store.update(orderId, { status: status, status_label: STATUS_LABEL[status], settled: true, message: msg || 'paiement non abouti — rien n\'a été débité' });
      } else {
        this.store.update(orderId, { status: status, status_label: STATUS_LABEL[status] || 'en cours' });
      }
    } else {   // withdrawal
      if (status === STATUS.SUCCESS){
        this.bank.completeWithdrawal(rec.account, rec.amount, rec.order_id);        // hold -> out
        this.store.update(orderId, { status: STATUS.SUCCESS, status_label: 'réussi', settled: true });
      } else if (status === STATUS.FAILED || status === STATUS.CANCELLED){
        this.bank.releaseWithdrawal(rec.account, rec.amount, rec.order_id);         // hold -> Earnings
        this.store.update(orderId, { status: status, status_label: STATUS_LABEL[status], settled: true, message: msg || 'retrait échoué — remboursé sur vos Gains' });
      } else {   // in_transit / in_progress -> keep held, keep polling
        this.store.update(orderId, { status: status, status_label: STATUS_LABEL[status] || 'en transit' });
      }
    }
    return { ok: true, record: this.store.get(orderId) };
  }

  _validate(account, amount, provider, phone, min){
    if (!this.cfg.ready) return { reason: 'payments_disabled' };
    if (!this.store.hasCompliance(account)) return { reason: 'attestation_required' };
    amount = amount | 0;
    if (!(amount > 0)) return { reason: 'invalid_amount' };
    if (amount < min) return { reason: 'below_min', min: min };
    var pv = providerByKey(provider);
    if (!pv) return { reason: 'bad_provider' };
    var norm = normalizePhone(provider, phone);
    if (!norm.ok) return { reason: 'bad_phone', detail: norm.reason };
    return { ok: true, amount: amount, provider: pv, phone: norm.phone };
  }

  // DEPOSIT (top up Credit). Writes PENDING first, then calls C2B. Credit is
  // applied only when a success is reported (direct for simulator, else callback).
  async startDeposit(account, req){
    var v = this._validate(account, req.amount, req.provider, req.phone, this.cfg.depositMin);
    if (!v.ok) return { ok: false, reason: v.reason, min: v.min, detail: v.detail };

    var orderId = 'dep_' + randomUUID();
    this.store.create({ order_id: orderId, account: account, kind: 'deposit', amount: v.amount,
      provider: req.provider, provider_id: v.provider.id, phone: v.phone,
      status: STATUS.INITIATED, status_label: 'initié', settled: false, credited: false });

    var resp;
    try { resp = await this.client.deposit(orderId, v.amount, v.provider.id, v.phone, req.callbackUrl); }
    catch (e){
      this.store.update(orderId, { status: STATUS.FAILED, status_label: 'échoué', settled: true, message: 'impossible de joindre la passerelle de paiement' });
      return { ok: false, reason: 'gateway_error', order_id: orderId };
    }
    var st = readStatus(resp.data);
    this.store.update(orderId, { message: readMessage(resp.data) });
    if (st === STATUS.SUCCESS || st === STATUS.FAILED || st === STATUS.CANCELLED) this.applyStatus(orderId, st, resp.data);
    else this.store.update(orderId, { status: st == null ? STATUS.IN_PROGRESS : st, status_label: STATUS_LABEL[st == null ? 1 : st] });
    return { ok: true, order_id: orderId, record: this.store.get(orderId) };
  }

  // WITHDRAWAL (cash out Earnings). Holds the amount IMMEDIATELY (double-spend
  // safe), then calls B2C. If we never reached the gateway, the hold is released.
  async startWithdrawal(account, req){
    var v = this._validate(account, req.amount, req.provider, req.phone, this.cfg.withdrawMin);
    if (!v.ok) return { ok: false, reason: v.reason, min: v.min, detail: v.detail };

    var already = this.withdrawnToday(account);
    if (already + v.amount > this.cfg.withdrawDailyCap)
      return { ok: false, reason: 'daily_cap', cap: this.cfg.withdrawDailyCap, already: already };

    var orderId = 'wd_' + randomUUID();
    var hold = this.bank.holdWithdrawal(account, v.amount, orderId);        // atomic Earnings -> hold
    if (!hold.ok) return { ok: false, reason: hold.reason === 'insufficient' ? 'insufficient_earnings' : hold.reason };

    this.store.create({ order_id: orderId, account: account, kind: 'withdrawal', amount: v.amount,
      provider: req.provider, provider_id: v.provider.id, phone: v.phone,
      status: STATUS.INITIATED, status_label: 'initié', settled: false });

    var resp;
    try { resp = await this.client.withdraw(orderId, v.amount, v.provider.id, v.phone, req.callbackUrl); }
    catch (e){
      this.bank.releaseWithdrawal(account, v.amount, orderId);              // never reached them -> refund hold
      this.store.update(orderId, { status: STATUS.FAILED, status_label: 'failed', settled: true, message: 'could not reach the payment gateway — refunded to your Earnings' });
      return { ok: false, reason: 'gateway_error', order_id: orderId };
    }
    var confirmType = readConfirmType(resp.data);
    var st = readStatus(resp.data);
    this.store.update(orderId, { confirm_type: confirmType, message: readMessage(resp.data) });
    if (st === STATUS.SUCCESS || st === STATUS.FAILED || st === STATUS.CANCELLED) this.applyStatus(orderId, st, resp.data);
    else this.store.update(orderId, { status: st == null ? STATUS.IN_PROGRESS : st, status_label: STATUS_LABEL[st == null ? 1 : st] });
    return { ok: true, order_id: orderId, confirm_type: confirmType, record: this.store.get(orderId) };
  }

  // CALLBACK: verify signature FIRST, store raw, then process idempotently.
  // Returns { http } — 200 for anything signed (so retries stop), non-200 only
  // for a bad signature (rejected, never processed).
  handleCallback(body){
    var valid = verifySignature(body, this.cfg.secret);
    this.store.addCallback({ order_id: body && body.order_id, valid: valid, raw: body });
    if (!valid) return { ok: false, http: 401, reason: 'bad_signature' };
    var orderId = body.order_id;
    var rec = orderId ? this.store.get(orderId) : null;
    if (!rec) return { ok: true, http: 200, reason: 'unknown_order' };
    var status = readStatus(body);
    if (status == null) return { ok: true, http: 200, reason: 'no_status' };
    this.applyStatus(orderId, status, body);
    return { ok: true, http: 200, record: this.store.get(orderId) };
  }

  // Poll /status and apply (manual refresh + reconciliation).
  async pollStatus(orderId){
    var rec = this.store.get(orderId);
    if (!rec) return { ok: false, reason: 'unknown_order' };
    if (rec.settled) return { ok: true, record: rec };
    var resp;
    try { resp = await this.client.status(orderId); } catch (e) { return { ok: false, reason: 'gateway_error' }; }
    var status = readStatus(resp.data);
    if (status != null) this.applyStatus(orderId, status, resp.data);
    return { ok: true, record: this.store.get(orderId) };
  }

  async reconcile(now){
    var stale = this.store.listStale(RECONCILE_AFTER_MS, now);
    for (var i = 0; i < stale.length; i++) await this.pollStatus(stale[i].order_id);
    return stale.length;
  }

  // sum of non-failed withdrawals initiated today (daily cap)
  withdrawnToday(account){
    var start = startOfDayMs(), sum = 0;
    var recs = this.store.listByAccount(account, 500);
    for (var i = 0; i < recs.length; i++){
      var r = recs[i];
      if (r.kind === 'withdrawal' && r.created_ms >= start && r.status !== STATUS.FAILED && r.status !== STATUS.CANCELLED) sum += r.amount;
    }
    return sum;
  }
}
