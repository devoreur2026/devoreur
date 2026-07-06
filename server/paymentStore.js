// Durable record of every deposit/withdrawal + every raw callback + the one-time
// 18+/Terms attestation. In-memory authoritative (synchronous, race-free) with
// optional write-through sinks a Supabase layer attaches. Pending records must
// survive a restart so a late callback (2-3 min) still finds its payment.
function nowMs(){ return Date.now(); }
function nowISO(){ return new Date().toISOString(); }
function safe(fn, arg){ try { fn(arg); } catch (e) { console.error('[payments store sink]', e && e.message); } }

// Non-terminal statuses still worth polling: initiated/in_progress/in_transit.
export function isTerminal(rec){ return !!rec.settled; }

export class PaymentStore {
  constructor(){
    this.payments = new Map();   // order_id -> record
    this.callbacks = [];         // raw callbacks (audit trail)
    this.compliance = new Map(); // account -> { account, attested_at, terms_version }
    this.onCreate = null; this.onUpdate = null; this.onCallback = null; this.onCompliance = null;
  }

  create(rec){
    rec.created_ms = rec.created_ms || nowMs();
    rec.created_at = rec.created_at || nowISO();
    rec.updated_at = rec.created_at;
    this.payments.set(rec.order_id, rec);
    if (this.onCreate) safe(this.onCreate, rec);
    return rec;
  }
  get(orderId){ return this.payments.get(orderId) || null; }
  update(orderId, patch){
    var r = this.payments.get(orderId);
    if (!r) return null;
    Object.assign(r, patch);
    r.updated_at = nowISO();
    if (this.onUpdate) safe(this.onUpdate, r);
    return r;
  }

  // newest-first payments for an account (wallet history)
  listByAccount(account, limit){
    var out = [];
    var all = Array.from(this.payments.values()).filter(function(r){ return r.account === account; });
    all.sort(function(a, b){ return b.created_ms - a.created_ms; });
    for (var i = 0; i < all.length && out.length < (limit || 50); i++) out.push(all[i]);
    return out;
  }

  // unsettled payments older than a threshold (reconciliation poll)
  listStale(olderThanMs, now){
    now = now || nowMs();
    var out = [];
    for (var r of this.payments.values()){
      if (!r.settled && (now - r.created_ms) >= olderThanMs) out.push(r);
    }
    return out;
  }

  addCallback(entry){
    entry.received_at = entry.received_at || nowISO();
    this.callbacks.push(entry);
    if (this.onCallback) safe(this.onCallback, entry);
    return entry;
  }

  getCompliance(account){ return this.compliance.get(account) || null; }
  hasCompliance(account){ return this.compliance.has(account); }
  setCompliance(account, termsVersion){
    if (this.compliance.has(account)) return this.compliance.get(account);   // one-time, immutable
    var rec = { account: account, attested_at: nowISO(), terms_version: termsVersion || '1' };
    this.compliance.set(account, rec);
    if (this.onCompliance) safe(this.onCompliance, rec);
    return rec;
  }
}
