// Deposit / withdraw UI in the wallet panel. All money moves are server-driven:
// we only POST a request and then poll/refresh status. The whole section is
// hidden unless the server reports payments enabled.
import { auth } from './auth.js';
import { STATUS, providerByKey, normalizePhone } from '../shared/payments.js';

function el(id){ return document.getElementById(id); }
var cfg = null;
var ui = { tab: 'deposit', attested: false, providersFilled: false };

async function api(path, method, body){
  var token = await auth.accessToken();
  var res = await fetch(path, {
    method: method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  var data = null; try { data = await res.json(); } catch (e) {}
  return { code: res.status, data: data };
}
async function loadConfig(){
  if (cfg) return cfg;
  try { cfg = await (await fetch('/api/pay/config', { cache: 'no-store' })).json(); }
  catch (e) { cfg = { enabled: false }; }
  return cfg;
}

function msg(t, kind){ var m = el('payMsg'); m.textContent = t || ''; m.style.color = kind === 'bad' ? '#e8574a' : 'var(--gold)'; }

var REASONS = {
  payments_disabled: 'Payments are currently unavailable.',
  attestation_required: 'Please confirm you are 18+ and accept the Terms.',
  below_min: 'Amount is below the minimum.',
  invalid_amount: 'Enter a valid amount.',
  bad_provider: 'Choose a mobile money provider.',
  bad_phone: 'Check the phone number for this provider.',
  insufficient_earnings: 'Not enough Earnings to withdraw that.',
  daily_cap: 'You have reached your daily withdrawal limit.',
  gateway_error: 'Could not reach the payment gateway — try again.',
  rate_limited: 'Too many attempts — wait a moment.'
};
function reasonText(d){
  if (!d) return 'Something went wrong — try again.';
  var base = REASONS[d.reason] || 'Could not complete the request.';
  if (d.reason === 'below_min' && d.min) base = 'Minimum is ' + d.min + ' CDF.';
  if (d.reason === 'daily_cap' && d.cap) base = 'Daily limit is ' + d.cap + ' CDF (already ' + (d.already || 0) + ').';
  if (d.reason === 'bad_phone' && d.detail) base = d.detail;
  return base;
}

function fillProviders(){
  if (ui.providersFilled || !cfg.providers) return;
  el('payProvider').innerHTML = cfg.providers.map(function(p){ return '<option value="' + p.key + '">' + p.label + '</option>'; }).join('');
  ui.providersFilled = true;
}
function setTab(tab){
  ui.tab = tab;
  el('tabDeposit').classList.toggle('on', tab === 'deposit');
  el('tabWithdraw').classList.toggle('on', tab === 'withdraw');
  el('payBtn').textContent = tab === 'deposit' ? 'Deposit' : 'Withdraw';
  el('payAmount').placeholder = 'amount CDF (min ' + (tab === 'deposit' ? cfg.depositMin : cfg.withdrawMin) + ')';
  msg('');
}
// show the selected provider's required phone format under the number field
function updateHint(){
  var p = providerByKey(el('payProvider').value);
  el('payPhoneHint').textContent = p ? ('Format: ' + p.hint) : '';
}

function statusClass(p){
  if (p.status === STATUS.SUCCESS) return 'ok';
  if (p.status === STATUS.FAILED || p.status === STATUS.CANCELLED) return 'bad';
  return 'wait';
}
function renderHistory(list){
  var h = el('payHistory'); h.innerHTML = '';
  (list || []).forEach(function(p){
    var row = document.createElement('div'); row.className = 'prow';
    var left = document.createElement('span');
    left.innerHTML = (p.kind === 'deposit' ? 'Deposit ' : 'Withdraw ') + '<b>' + p.amount + '</b> CDF ' +
      '<span class="pst ' + statusClass(p) + '">· ' + p.status_label + '</span>';
    var right = document.createElement('span');
    if (!p.settled){
      var b = document.createElement('button'); b.className = 'refresh'; b.textContent = 'refresh';
      b.addEventListener('click', function(){ b.disabled = true; api('/api/pay/status', 'POST', { order_id: p.order_id }).then(function(){ refreshPayments(); }); });
      right.appendChild(b);
    }
    row.appendChild(left); row.appendChild(right); h.appendChild(row);
  });
}

export async function refreshPayments(){
  var c = await loadConfig();
  var sec = el('cashSection');
  if (!c || !c.enabled){ sec.classList.add('hide'); return; }   // hidden unless enabled
  sec.classList.remove('hide');
  fillProviders();
  updateHint();
  if (!ui.tabInit){ setTab('deposit'); ui.tabInit = true; }
  var me = await api('/api/pay/me');
  ui.attested = !!(me.data && me.data.attested);
  el('attestRow').classList.toggle('hide', ui.attested);
  renderHistory(me.data ? me.data.payments : []);
}

async function submit(){
  var amount = parseInt(el('payAmount').value, 10) || 0;
  var provider = el('payProvider').value;
  var phone = el('payPhone').value.trim();
  var min = ui.tab === 'deposit' ? cfg.depositMin : cfg.withdrawMin;
  if (amount < min){ msg('Minimum is ' + min + ' CDF.', 'bad'); return; }
  // validate/normalize the phone for the chosen provider BEFORE any money request
  var v = normalizePhone(provider, phone);
  if (!v.ok){ msg(v.reason, 'bad'); return; }
  phone = v.phone;
  if (!ui.attested){
    if (!el('attestChk').checked){ msg('Please confirm you are 18+ and accept the Terms.', 'bad'); return; }
    var a = await api('/api/pay/attest', 'POST', { accept: true });
    if (a.code !== 200){ msg('Could not record your confirmation — try again.', 'bad'); return; }
    ui.attested = true; el('attestRow').classList.add('hide');
  }
  var btn = el('payBtn'); btn.disabled = true;
  msg(ui.tab === 'deposit' ? 'Sending request…' : 'Requesting withdrawal…');
  var r = await api(ui.tab === 'deposit' ? '/api/pay/deposit' : '/api/pay/withdraw', 'POST', { amount: amount, provider: provider, phone: phone });
  btn.disabled = false;
  if (r.code !== 200 || !r.data || !r.data.ok){ msg(reasonText(r.data), 'bad'); return; }
  if (ui.tab === 'deposit'){
    msg('Approve the payment on your phone (' + phone + '). This can take 2–3 minutes; the status will update below.');
  } else if (r.data.confirm_type){
    msg('Confirm the withdrawal on your phone (a code may be sent).');
  } else {
    msg('Withdrawal requested — the status will update below.');
  }
  el('payAmount').value = '';
  refreshPayments();
}

export function initPaymentsUi(){
  el('tabDeposit').addEventListener('click', function(){ setTab('deposit'); });
  el('tabWithdraw').addEventListener('click', function(){ setTab('withdraw'); });
  el('payProvider').addEventListener('change', updateHint);
  el('payBtn').addEventListener('click', submit);
  // the wallet panel dispatches this when opened
  document.addEventListener('umbra-wallet-open', function(){ refreshPayments(); });
}
