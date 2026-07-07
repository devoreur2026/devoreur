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
  el('entryVal').textContent = e.open ? ('ENTRÉE ' + (e.price || 0)) : 'ENTRÉES FERMÉES';
  el('entryVal').className = e.open ? '' : 'locked';
  var bv = el('bonusVal');
  bv.textContent = 'BONUS ' + (e.bonusPot || 15000);   // guaranteed prize floor, always on
  bv.className = 'unlocked';
  var tEl = document.getElementById('timer');
  if (tEl) tEl.style.color = e.open ? '' : '#e8574a';   // round timer reddens once entries close

  var b = el('spectateBanner');
  if (net.spectating){
    var msg = el('specMsg'), wbtn = el('specWalletBtn');
    if (specReason === 'insufficient'){
      el('specTitle').textContent = '◉ SPECTATEUR';
      msg.textContent = 'L\'entrée coûte ' + (e.price || 1000) + ' Crédit — vous avez ' + ((net.wallet && net.wallet.credit) || 0) + '. Ajoutez des fonds et vous entrez aussitôt dans le labyrinthe.';
      wbtn.classList.remove('hide');
    } else if (specReason === 'locked'){
      el('specTitle').textContent = '◉ SESSION EN FIN';
      msg.textContent = 'Cette session se termine — une nouvelle commence dans un instant.';
      wbtn.classList.add('hide');
    } else {
      el('specTitle').textContent = '◉ SPECTATEUR';
      msg.textContent = 'Explorez et observez — payez l\'entrée et lancez-vous quand vous voulez.';
      wbtn.classList.remove('hide');
    }
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

var TXLABEL = {
  entry:'entrée', entry_stake:'entrée (mise)', grant:'crédit offert', rake:'commission',
  kill_reward:'prime de kill', kill_pot:'part cagnotte', kill_house:'part maison',
  kill_pvp:'touché', kill_eater:'dévoré', payout:'gain', bonus:'bonus',
  buylives:'vies achetées', buylives_stake:'vies achetées',
  forfeit:'mise perdue', forfeit_house:'part maison', forfeit_pot:'part cagnotte', refund:'remboursement',
  deposit:'dépôt', withdraw:'retrait', hold:'retrait en cours', release:'retrait annulé',
  transfer:'transfert', shop:'boutique', rollover_in:'report', rollover_out:'report',
  sweep:'récupération', sweep_stake:'récupération', sweep_pot:'récupération',
  sweep_house:'part maison', sweep_deadpot:'report', sweep_potin:'report'
};
var BUCKET = { credit:'Crédit', earnings:'Gains', stake:'mise', hold:'en attente' };

function renderWalletHistory(rows){
  var h = el('walletHistory'); h.innerHTML = '';
  (rows || []).forEach(function(r){
    var row = document.createElement('div'); row.className = 'row';
    var lab = document.createElement('span'); lab.textContent = TXLABEL[r.type] || r.type.replace(/_/g, ' ');
    var amt = document.createElement('span'); amt.className = r.amount >= 0 ? 'pos' : 'neg';
    amt.textContent = (r.amount >= 0 ? '+' : '') + r.amount + ' ' + (BUCKET[r.bucket] || r.bucket);
    row.appendChild(lab); row.appendChild(amt); h.appendChild(row);
  });
  if (!(rows && rows.length)) h.innerHTML = '<div class="row"><span>aucune transaction pour l\'instant</span><span></span></div>';
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
function walletMsg(t, bad){ var m = el('walletMsg'); if (m){ m.textContent = t || ''; m.style.color = bad ? 'var(--danger)' : 'var(--lime)'; } }

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

// Fire on a normal click AND on a genuine mobile tap (touchend without a drag).
// iOS Safari swallows the first click right after a momentum scroll, so buttons
// inside scrollable overlays need this to be reliable.
function onTap(id, fn){
  var n = (typeof id === 'string') ? document.getElementById(id) : id;
  if (!n) return;
  n.addEventListener('click', fn);
  var sx = 0, sy = 0, moved = false;
  n.addEventListener('touchstart', function(ev){ var t = ev.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; }, { passive: true });
  n.addEventListener('touchmove', function(ev){ var t = ev.touches[0]; if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) moved = true; }, { passive: true });
  n.addEventListener('touchend', function(ev){ if (!moved){ ev.preventDefault(); fn(ev); } });
}

/* ---- how-to-play overlay (home screen + in-game "?" button) ---- */
function openHelp(){
  state.uiBusy = true;                          // pause game input while reading
  el('ovHelp').classList.remove('hide');
  if (document.exitPointerLock) document.exitPointerLock();
}
function closeHelp(){ state.uiBusy = false; el('ovHelp').classList.add('hide'); }
onTap('helpBtn', openHelp); onTap('helpLink', openHelp); onTap('helpBtnGame', openHelp);
onTap('helpClose', closeHelp);
onTap('specWalletBtn', function(){ openWallet(false); });   // banner (in-game) -> wallet

// Earnings -> Credit over HTTP (works from the home screen too, not just in-game,
// where there'd be no socket). Idempotent per nonce; clear feedback on failure.
el('xferBtn').addEventListener('click', function(){
  var a = parseInt(el('xferAmt').value, 10) || 0;
  if (a <= 0){ walletMsg('Entrez un montant à transférer.', true); return; }
  var btn = this; btn.disabled = true;
  walletHttp('/api/wallet/transfer', 'POST', { amount: a, nonce: net.nonce() }).then(function(d){
    btn.disabled = false;
    if (d && d.ok){ applyWallet(d); el('xferAmt').value = ''; walletMsg('Transféré ' + a + ' vers le Crédit.'); }
    else walletMsg(d && d.reason === 'insufficient' ? 'Pas assez de Gains pour ce transfert.' : 'Transfert impossible — réessayez.', true);
  });
});
// Buy a pack of 10 fireballs over HTTP; the inventory persists on your account.
el('shopBtn').addEventListener('click', function(){
  var btn = this; btn.disabled = true;
  walletHttp('/api/wallet/shop', 'POST', { nonce: net.nonce() }).then(function(d){
    btn.disabled = false;
    if (d && d.ok){ applyWallet(d); walletMsg('10 boules de feu achetées.'); }
    else walletMsg(d && d.reason === 'insufficient' ? 'Crédit insuffisant (100 requis).' : 'Achat échoué — réessayez.', true);
  });
});

/* ---- mobile fire button ---- */
if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches){
  var fb = el('fireBtn');
  fb.classList.remove('hide');
  fb.addEventListener('pointerdown', function(e){ e.preventDefault(); throwFireball(); });
}
