// The economy UI: wallet bar (Credit / Earnings / fireballs), pot + bonus
// status, kill feed, spectate banner, the mobile fire button, and the wallet
// panel (balances, ledger history, Earnings->Credit transfer, shop, dev grant).
// All state comes from the server (net.wallet / net.econ); this only displays it
// and sends validated requests.
import { net } from './net.js';
import { state } from './state.js';
import { throwFireball } from './player.js';

function el(id){ return document.getElementById(id); }

/* ---- wallet bar + pot bar (from snapshots) ---- */
net.on('wallet', function(w){
  el('wCredit').textContent = w.credit;
  el('wEarn').textContent = w.earnings;
  el('wFb').textContent = w.fireballs;
  if (!el('ovWallet').classList.contains('hide')) refreshPanel();
});
/* ---- spectate banner (driven by net.spectating every snapshot, so it can
       never get stuck out of sync with the server) ---- */
var specReason = 'midround';
net.on('spectate', function(m){ specReason = (m && m.reason) || 'midround'; });

net.on('state', function(){
  var e = net.econ || {};
  el('potVal').textContent = e.pot || 0;
  el('entryVal').textContent = e.open ? ('ENTRY ' + (e.price || 0)) : 'ENTRIES CLOSED';
  el('entryVal').className = e.open ? '' : 'locked';
  var bv = el('bonusVal');
  if (e.paid >= 5){ bv.textContent = 'BONUS unlocked'; bv.className = 'unlocked'; }
  else { bv.textContent = 'BONUS 🔒 ' + (e.paid || 0) + '/5'; bv.className = 'locked'; }
  var tEl = document.getElementById('timer');
  if (tEl) tEl.style.color = e.open ? '' : '#e8574a';   // round timer reddens once entries close

  var b = el('spectateBanner');
  if (net.spectating){
    if (specReason === 'insufficient')
      b.innerHTML = '<b>◉ SPECTATING</b>Not enough Credit to enter (need ' + (e.price || 1000) + '). Open your wallet ◈ to add Credit — you join the next round.';
    else if (specReason === 'locked')
      b.innerHTML = '<b>◉ ENTRIES CLOSED</b>The round is locked (8:00). Watch the finish — you auto-enter the next round.';
    else
      b.innerHTML = '<b>◉ SPECTATING</b>You join the next round — roam and watch for now.';
    b.classList.remove('hide');
  } else {
    b.classList.add('hide');
  }
});

/* ---- kill feed ---- */
net.on('killfeed', function(text){
  var f = el('killfeed'), d = document.createElement('div');
  d.textContent = text; f.appendChild(d);
  while (f.children.length > 5) f.removeChild(f.firstChild);
  setTimeout(function(){ d.style.opacity = 0; setTimeout(function(){ if (d.parentNode) d.parentNode.removeChild(d); }, 600); }, 5000);
});

/* ---- wallet panel ---- */
function refreshPanel(){
  el('pwCredit').textContent = net.wallet.credit;
  el('pwEarn').textContent = net.wallet.earnings;
  el('pwFb').textContent = net.wallet.fireballs;
}
function openWallet(){
  state.uiBusy = true;
  el('ovWallet').classList.remove('hide');
  if (document.exitPointerLock) document.exitPointerLock();
  refreshPanel(); net.requestHistory();
  document.dispatchEvent(new Event('umbra-wallet-open'));   // let the payments UI refresh
}
function closeWallet(){ state.uiBusy = false; el('ovWallet').classList.add('hide'); }
el('coinBtn').addEventListener('click', function(){ el('ovWallet').classList.contains('hide') ? openWallet() : closeWallet(); });
el('walletClose').addEventListener('click', closeWallet);
el('xferBtn').addEventListener('click', function(){ var a = parseInt(el('xferAmt').value, 10) || 0; if (a > 0){ net.transfer(a); el('xferAmt').value = ''; } });
el('shopBtn').addEventListener('click', function(){ this.disabled = true; net.buyFireballs(); var b = this; setTimeout(function(){ b.disabled = false; }, 400); });
el('grantBtn').addEventListener('click', function(){ net.grantDev(); });

net.on('history', function(rows){
  var h = el('walletHistory'); h.innerHTML = '';
  rows.forEach(function(r){
    var row = document.createElement('div'); row.className = 'row';
    var lab = document.createElement('span'); lab.textContent = r.type.replace(/_/g, ' ');
    var amt = document.createElement('span'); amt.className = r.amount >= 0 ? 'pos' : 'neg';
    amt.textContent = (r.amount >= 0 ? '+' : '') + r.amount + ' ' + r.bucket;
    row.appendChild(lab); row.appendChild(amt); h.appendChild(row);
  });
  if (!rows.length) h.innerHTML = '<div class="row"><span>no transactions yet</span><span></span></div>';
});

/* ---- dev grant button + mobile fire button ---- */
fetch('/api/config').then(function(r){ return r.json(); }).then(function(c){
  if (c && c.dev) el('grantBtn').classList.remove('hide');
}).catch(function(){});

if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches){
  var fb = el('fireBtn');
  fb.classList.remove('hide');
  fb.addEventListener('pointerdown', function(e){ e.preventDefault(); throwFireball(); });
}
