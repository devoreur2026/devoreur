// Durable persistence for the ledger in Supabase (append-only). The in-memory
// Ledger stays the authoritative, synchronous source of truth (that's what
// guarantees atomicity + no races); this mirrors every row to Postgres so the
// wallet survives restarts, and rebuilds the in-memory balances from those rows
// on boot. Server-only: it uses the SERVICE ROLE key, and RLS denies clients any
// access to the ledger tables (the server serves wallet/history to clients).
//
// Requires env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. If the key is absent
// the game runs in-memory only (fine for local dev / LEDGER MODE testing).
var URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function ledgerPersistenceConfigured(){ return !!(URL && KEY); }

function headers(extra){
  return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, extra || {});
}
async function rest(path, opts){
  return fetch(URL + '/rest/v1' + path, opts);
}

// load every row of a table (paged) so we can rebuild balances deterministically
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

// Rebuild the in-memory ledger from Supabase, then attach durable sinks.
export async function initLedgerStore(ledger){
  if (!ledgerPersistenceConfigured()) return false;

  var rows = await loadAll('/umbra_ledger?select=id,tx,account,bucket,type,amount,balance_after,round,counterparty,ts&order=id.asc');
  ledger.bal.clear(); ledger.rows.length = 0; ledger.applied.clear();
  var maxId = 0;
  for (var i = 0; i < rows.length; i++){
    var r = rows[i], k = r.account + '|' + r.bucket;
    ledger.bal.set(k, (ledger.bal.get(k) || 0) + r.amount);
    ledger.rows.push({ id: r.id, ts: r.ts, tx: r.tx, account: r.account, bucket: r.bucket, type: r.type,
                       amount: r.amount, balanceAfter: r.balance_after, round: r.round, counterparty: r.counterparty });
    ledger.applied.set(r.tx, { ok: true, persisted: true });   // idempotency survives restarts
    if (r.id > maxId) maxId = r.id;
  }
  ledger.nextId = maxId + 1;

  var inv = await loadAll('/umbra_inventory?select=account,fireballs');
  for (var j = 0; j < inv.length; j++) ledger.inv.set(inv[j].account, inv[j].fireballs);

  // append-only write-through (fire-and-forget; loud on failure, never blocks a tick)
  ledger.sink = function(appended){
    var body = appended.map(function(row){
      return { id: row.id, tx: row.tx, account: row.account, bucket: row.bucket, type: row.type,
               amount: row.amount, balance_after: row.balanceAfter, round: row.round, counterparty: row.counterparty };
    });
    rest('/umbra_ledger', { method: 'POST', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) })
      .then(function(res){ if (!res.ok) res.text().then(function(t){ console.error('[ledger persist] insert failed', res.status, t.slice(0, 200)); }); })
      .catch(function(e){ console.error('[ledger persist] insert error', e && e.message); });
  };
  ledger.invSink = function(account, count){
    rest('/umbra_inventory', { method: 'POST', headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ account: account, fireballs: count }]) })
      .then(function(res){ if (!res.ok) res.text().then(function(t){ console.error('[ledger persist] inventory upsert failed', res.status, t.slice(0, 200)); }); })
      .catch(function(e){ console.error('[ledger persist] inventory error', e && e.message); });
  };

  console.log('[ledger] Supabase persistence ON — loaded ' + rows.length + ' rows, ' + inv.length + ' inventories.');
  return true;
}
