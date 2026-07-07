// The economy UI: wallet bar (Credit / Earnings / fireballs), pot + bonus
// status, kill feed, spectate banner, the mobile fire button, and the wallet
// panel (balances, ledger history, Earnings->Credit transfer, shop). The panel
// works in-game (over the socket) AND standalone from the home screen (over
// HTTP), so a player can top up / cash out without entering the maze.
import { net } from './net.js';
import { state } from './state.js';
import { auth } from './auth.js';
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
  bv.textContent = 'BONUS ' + (e.bonusPot || 15000);   // guaranteed prize floor, always on
  bv.className = 'unlocked';
  var tEl = document.getElementById('timer');
  if (tEl) tEl.style.color = e.open ? '' : '#e8574a';   // round timer reddens once entries close

  var b = el('spectateBanner');
  if (net.spectating){
    if (specReason === 'insufficient')
      b.innerHTML = '<b>◉ SPECTATING</b>Entry is ' + (e.price || 1000) + ' Credit — you have ' + ((net.wallet && net.wallet.credit) || 0) + '. Add funds and you jump straight into the maze.<button class="specBtn" id="specWalletBtn">◈ Open Wallet</button>';
    else if (specReason === 'locked')
      b.innerHTML = '<b>◉ SESSION ENDING</b>This session is wrapping up — a fresh one starts in a moment.';
    else
      b.innerHTML = '<b>◉ SPECTATING</b>Roam and watch — pay the entry and jump in whenever you\'re ready.<button class="specBtn" id="specWalletBtn">◈ Open Wallet</button>';
    b.classList.remove('hide');
  } else {
    b.classList.add('hide');
  }
});
// the Open-Wallet button lives inside the banner (rebuilt each tick) -> delegate
el('spectateBanner').addEventListener('click', function(ev){
  var t = ev.target;
  if (t && (t.id === 'specWalletBtn' || (t.closest && t.closest('#specWalletBtn')))) openWallet(false);
});

/* ---- kill feed ---- */
net.on('killfeed', function(text){
  var f = el('killfeed'), d = document.createElement('div');
  d.textContent = text; f.appendChild(d);
  while (f.children.length > 5) f.removeChild(f.firstChild);
  setTimeout(function(){ d.style.opacity = 0; setTimeout(function(){ if (d.parentNode) d.parentNode.removeChild(d); }, 600); }, 5000);
});

/* ---- wallet panel (in-game over the socket, or standalone over HTTP) ---- */
var walletMode = 'game';   // 'game' | 'standalone'

function setBalances(credit, earnings, fireballs){
  el('pwCredit').textContent = credit;
  el('pwEarn').textContent = earnings;
  el('pwFb').textContent = fireballs;
  el('wCredit').textContent = credit;         // keep the in-game top bar consistent
  el('wEarn').textContent = earnings;
  el('wFb').textContent = fireballs;
}
function refreshPanel(){ setBalances(net.wallet.credit, net.wallet.earnings, net.wallet.fireballs); }

function renderWalletHistory(rows){
  var h = el('walletHistory'); h.innerHTML = '';
  (rows || []).forEach(function(r){
    var row = document.createElement('div'); row.className = 'row';
    var lab = document.createElement('span'); lab.textContent = r.type.replace(/_/g, ' ');
    var amt = document.createElement('span'); amt.className = r.amount >= 0 ? 'pos' : 'neg';
    amt.textContent = (r.amount >= 0 ? '+' : '') + r.amount + ' ' + r.bucket;
    row.appendChild(lab); row.appendChild(amt); h.appendChild(row);
  });
  if (!(rows && rows.length)) h.innerHTML = '<div class="row"><span>no transactions yet</span><span></span></div>';
}
net.on('history', function(rows){ if (walletMode === 'game') renderWalletHistory(rows); });

async function walletHttp(path, method, body){
  var token = await auth.accessToken();
  var res = await fetch(path, {
    method: method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
  });
  try { return await res.json(); } catch (e) { return null; }
}
function applyWallet(d){                       // apply an HTTP wallet response everywhere
  setBalances(d.credit, d.earnings, d.fireballs);
  renderWalletHistory(d.history);
  net.wallet = { credit: d.credit, earnings: d.earnings, fireballs: d.fireballs };   // keep top bar + fireball-throw in sync
}
async function loadWalletHttp(){
  var d = await walletHttp('/api/wallet');
  if (d && d.ok) applyWallet(d);
}
function walletMsg(t, bad){ var m = el('walletMsg'); if (m){ m.textContent = t || ''; m.style.color = bad ? '#e8574a' : 'var(--gold)'; } }

function openWallet(standalone){
  walletMode = standalone ? 'standalone' : 'game';
  state.uiBusy = true;
  el('ovWallet').classList.remove('hide');
  if (document.exitPointerLock) document.exitPointerLock();
  walletMsg('');
  loadWalletHttp();                           // balances + history over HTTP — works in-game AND from home
  document.dispatchEvent(new Event('umbra-wallet-open'));  // let the payments UI refresh
}
function closeWallet(){ state.uiBusy = false; el('ovWallet').classList.add('hide'); }
el('coinBtn').addEventListener('click', function(){ el('ovWallet').classList.contains('hide') ? openWallet(false) : closeWallet(); });
el('walletBtn').addEventListener('click', function(){ openWallet(true); });   // from the home screen
el('walletClose').addEventListener('click', closeWallet);

/* ---- how-to-play overlay (home screen + in-game "?" button) ---- */
function openHelp(){
  state.uiBusy = true;                          // pause game input while reading
  el('ovHelp').classList.remove('hide');
  if (document.exitPointerLock) document.exitPointerLock();
}
function closeHelp(){ state.uiBusy = false; el('ovHelp').classList.add('hide'); }
['helpBtn', 'helpLink', 'helpBtnGame'].forEach(function(id){ var n = document.getElementById(id); if (n) n.addEventListener('click', openHelp); });
var helpCloseBtn = document.getElementById('helpClose'); if (helpCloseBtn) helpCloseBtn.addEventListener('click', closeHelp);

// Earnings -> Credit over HTTP (works from the home screen too, not just in-game,
// where there'd be no socket). Idempotent per nonce; clear feedback on failure.
el('xferBtn').addEventListener('click', function(){
  var a = parseInt(el('xferAmt').value, 10) || 0;
  if (a <= 0){ walletMsg('Enter an amount to move.', true); return; }
  var btn = this; btn.disabled = true;
  walletHttp('/api/wallet/transfer', 'POST', { amount: a, nonce: net.nonce() }).then(function(d){
    btn.disabled = false;
    if (d && d.ok){ applyWallet(d); el('xferAmt').value = ''; walletMsg('Moved ' + a + ' to Credit.'); }
    else walletMsg(d && d.reason === 'insufficient' ? 'Not enough Earnings to move that.' : 'Could not move funds — try again.', true);
  });
});
// Buy a pack of 10 fireballs over HTTP; the inventory persists on your account.
el('shopBtn').addEventListener('click', function(){
  var btn = this; btn.disabled = true;
  walletHttp('/api/wallet/shop', 'POST', { nonce: net.nonce() }).then(function(d){
    btn.disabled = false;
    if (d && d.ok){ applyWallet(d); walletMsg('Bought 10 fireballs.'); }
    else walletMsg(d && d.reason === 'insufficient' ? 'Not enough Credit (100 needed).' : 'Purchase failed — try again.', true);
  });
});

/* ---- mobile fire button ---- */
if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches){
  var fb = el('fireBtn');
  fb.classList.remove('hide');
  fb.addEventListener('pointerdown', function(e){ e.preventDefault(); throwFireball(); });
}
