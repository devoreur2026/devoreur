// Durable persistence for payments in Supabase. The in-memory PaymentStore stays
// authoritative; this loads open payments + compliance on boot (so a late
// callback after a restart still finds its payment) and write-throughs every
// change. Server-only (SERVICE ROLE key); RLS denies clients. Mirrors ledgerStore.
//
// Requires SUPABASE_URL + SUPABASE_SECRET_KEY and db/payments.sql applied.
var URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
// NEW server secret key; falls back to the legacy service_role key with a warning.
var KEY = process.env.SUPABASE_SECRET_KEY || '';
if (!KEY && process.env.SUPABASE_SERVICE_ROLE_KEY){
  KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.warn('[payments] using LEGACY SUPABASE_SERVICE_ROLE_KEY — set SUPABASE_SECRET_KEY and disable the legacy key.');
}

export function paymentPersistenceConfigured(){ return !!(URL && KEY); }

function headers(extra){
  return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, extra || {});
}
function rest(path, opts){ return fetch(URL + '/rest/v1' + path, opts); }
async function loadAll(path){
  var out = [], from = 0, page = 1000;
  for (;;){
    var res = await rest(path, { headers: headers({ Range: from + '-' + (from + page - 1), 'Range-Unit': 'items' }) });
    if (!res.ok) throw new Error('load ' + path + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
    var rows = await res.json();
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}
function paymentRow(r){
  return {
    order_id: r.order_id, account: r.account, kind: r.kind, amount: r.amount,
    provider: r.provider, provider_id: r.provider_id, phone: r.phone,
    status: r.status, status_label: r.status_label, settled: r.settled, credited: r.credited || false,
    confirm_type: r.confirm_type || 0, message: r.message || null,
    created_at: r.created_at, updated_at: r.updated_at || r.created_at
  };
}
function upsert(table, body){
  return rest('/' + table, { method: 'POST', headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(body) })
    .then(function(res){ if (!res.ok) res.text().then(function(t){ console.error('[payments persist] ' + table + ' upsert failed', res.status, t.slice(0, 200)); }); })
    .catch(function(e){ console.error('[payments persist] ' + table + ' error', e && e.message); });
}

export async function initPaymentStore(store){
  if (!paymentPersistenceConfigured()) return false;

  // load compliance (gates every deposit) + open + recent payments
  var comp = await loadAll('/umbra_compliance?select=account,attested_at,terms_version');
  for (var i = 0; i < comp.length; i++) store.compliance.set(comp[i].account, { account: comp[i].account, attested_at: comp[i].attested_at, terms_version: comp[i].terms_version });

  var pays = await loadAll('/umbra_payments?select=*&order=created_at.desc&limit=5000');
  for (var j = 0; j < pays.length; j++){
    var rec = paymentRow(pays[j]);
    rec.created_ms = Date.parse(rec.created_at) || Date.now();
    store.payments.set(rec.order_id, rec);
  }

  // write-through sinks (fire-and-forget; loud on failure, never blocks)
  store.onCreate = store.onUpdate = function(rec){
    upsert('umbra_payments', [{
      order_id: rec.order_id, account: rec.account, kind: rec.kind, amount: rec.amount,
      provider: rec.provider, provider_id: rec.provider_id, phone: rec.phone,
      status: rec.status, status_label: rec.status_label || null, settled: !!rec.settled, credited: !!rec.credited,
      confirm_type: rec.confirm_type || 0, message: rec.message || null,
      created_at: rec.created_at, updated_at: rec.updated_at
    }]);
  };
  store.onCallback = function(entry){
    rest('/umbra_callbacks', { method: 'POST', headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify([{ order_id: entry.order_id || null, valid: !!entry.valid, raw: entry.raw || {}, received_at: entry.received_at }]) })
      .then(function(res){ if (!res.ok) res.text().then(function(t){ console.error('[payments persist] callback insert failed', res.status, t.slice(0, 200)); }); })
      .catch(function(e){ console.error('[payments persist] callback error', e && e.message); });
  };
  store.onCompliance = function(rec){ upsert('umbra_compliance', [{ account: rec.account, attested_at: rec.attested_at, terms_version: rec.terms_version }]); };

  console.log('[payments] Supabase persistence ON — loaded ' + pays.length + ' payments, ' + comp.length + ' attestations.');
  return true;
}
