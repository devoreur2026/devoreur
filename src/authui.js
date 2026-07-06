// Wires the start-overlay auth panels to the auth module: sign in, sign up ->
// OTP verify, forgot -> reset via OTP, resend with cooldown, and the signed-in
// "ready" panel that starts the game. Human error messages throughout.
import { auth } from './auth.js';
import { enterMaze } from './game.js';
import { net } from './net.js';
import { state } from './state.js';

function el(id){ return document.getElementById(id); }
var errEl = el('authErr');
var panels = { signin: el('pSignin'), signup: el('pSignup'), otp: el('pOtp'), forgot: el('pForgot'), reset: el('pReset'), ready: el('pReady') };

var pendingEmail = '';        // email awaiting OTP (signup or reset)

// OTP length is provider-dependent (Supabase currently sends 8 digits); accept
// any 6–10 digit code so a length change can't break verification again.
function cleanCode(v){ return ('' + (v || '')).replace(/\D+/g, ''); }
function validCode(c){ return c.length >= 6 && c.length <= 10; }

function showErr(msg){ errEl.textContent = msg || ''; errEl.classList.toggle('hide', !msg); }
function clearErr(){ showErr(''); }
function show(name){
  clearErr();
  stopPoll();
  for (var k in panels) panels[k].classList.toggle('hide', k !== name);
  var first = panels[name].querySelector('.auth-input');
  if (first) setTimeout(function(){ try { first.focus(); } catch (e) {} }, 30);
}
function showReady(){
  var u = auth.user();
  el('whoName').textContent = u ? u.name : '';
  resetPlay();
  show('ready');
  startPoll();
}

// live round preview (entry price / pot / clock) while on the ready screen
var roundPoll = null;
function fmtClock(s){ var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
function pollRound(){
  fetch('/api/round', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(info){
    if (!info) return;
    el('joinInfo').innerHTML = info.open
      ? 'Entry <b>' + info.price + '</b> CDF · 4 lives · Pot <b>' + info.pot + '</b> · ' + fmtClock(info.elapsed) + ' / ' + fmtClock(info.limit || 3600)
      : 'Session ending (' + fmtClock(info.elapsed) + ') · Pot <b>' + info.pot + '</b> — you join the next one';
  }).catch(function(){});
}
function startPoll(){ if (!roundPoll){ pollRound(); roundPoll = setInterval(pollRound, 2500); } }
function stopPoll(){ if (roundPoll){ clearInterval(roundPoll); roundPoll = null; } }
function resetPlay(){ var b = el('playBtn'); b.disabled = false; b.textContent = 'Enter the maze'; }

// run an async action with a button in a "busy" state
async function busy(btn, label, fn){
  var old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

// resend cooldown shared by the OTP + reset "resend" links
var cooldownUntil = 0, cooldownTimer = null;
var resendLinks = [];
function tickCooldown(){
  var left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  resendLinks.forEach(function(l){
    if (left > 0){ l.classList.add('disabled'); l.textContent = 'Resend in ' + left + 's'; }
    else { l.classList.remove('disabled'); l.textContent = 'Resend code'; }
  });
  if (left <= 0 && cooldownTimer){ clearInterval(cooldownTimer); cooldownTimer = null; }
}
function startCooldown(sec){
  cooldownUntil = Date.now() + sec * 1000;
  if (!cooldownTimer) cooldownTimer = setInterval(tickCooldown, 500);
  tickCooldown();
}

/* ---------- panel navigation ---------- */
el('toSignup').onclick = function(){ show('signup'); };
el('toSignin').onclick = function(){ show('signin'); };
el('toForgot').onclick = function(){ show('forgot'); };
el('fgBack').onclick = function(){ show('signin'); };
el('otpBack').onclick = function(){ show('signin'); };
el('rsBack').onclick = function(){ show('signin'); };

/* ---------- sign in ---------- */
function doSignIn(){
  var email = el('siEmail').value.trim(), pass = el('siPass').value;
  if (!email || !pass){ showErr('Enter your email and password.'); return; }
  busy(el('siBtn'), 'Signing in…', async function(){
    var r = await auth.signIn(email, pass);
    if (r.ok) showReady(); else showErr(r.error);
  });
}
el('siBtn').onclick = doSignIn;
el('siPass').addEventListener('keydown', function(e){ if (e.key === 'Enter') doSignIn(); });

/* ---------- sign up ---------- */
function doSignUp(){
  var name = el('suName').value.trim(), email = el('suEmail').value.trim(), pass = el('suPass').value;
  if (!name){ showErr('Choose a display name.'); return; }
  if (!email){ showErr('Enter your email.'); return; }
  if (pass.length < 6){ showErr('Password must be at least 6 characters.'); return; }
  busy(el('suBtn'), 'Sending code…', async function(){
    var r = await auth.signUp(email, pass, name);
    if (!r.ok){ showErr(r.error); return; }
    pendingEmail = email;
    el('otpEmail').textContent = email;
    el('otpCode').value = '';
    show('otp');
    startCooldown(30);
  });
}
el('suBtn').onclick = doSignUp;
el('suPass').addEventListener('keydown', function(e){ if (e.key === 'Enter') doSignUp(); });

/* ---------- verify signup OTP ---------- */
function doVerify(){
  var code = cleanCode(el('otpCode').value);
  if (!validCode(code)){ showErr('Enter the code we emailed you.'); return; }
  busy(el('otpBtn'), 'Verifying…', async function(){
    var r = await auth.verifySignup(pendingEmail, code);
    if (r.ok) showReady(); else showErr(r.error);
  });
}
el('otpBtn').onclick = doVerify;
el('otpCode').addEventListener('keydown', function(e){ if (e.key === 'Enter') doVerify(); });
el('otpResend').onclick = function(){
  if (this.classList.contains('disabled')) return;
  startCooldown(30);
  auth.resendSignup(pendingEmail).then(function(r){ if (!r.ok) showErr(r.error); else showErr(''); });
};

/* ---------- forgot -> reset ---------- */
function doForgot(){
  var email = el('fgEmail').value.trim();
  if (!email){ showErr('Enter your email.'); return; }
  busy(el('fgBtn'), 'Sending…', async function(){
    var r = await auth.forgot(email);
    if (!r.ok){ showErr(r.error); return; }
    pendingEmail = email;
    el('rsEmail').textContent = email;
    el('rsCode').value = ''; el('rsPass').value = '';
    show('reset');
    startCooldown(30);
  });
}
el('fgBtn').onclick = doForgot;
el('fgEmail').addEventListener('keydown', function(e){ if (e.key === 'Enter') doForgot(); });

function doReset(){
  var code = cleanCode(el('rsCode').value), pass = el('rsPass').value;
  if (!validCode(code)){ showErr('Enter the code we emailed you.'); return; }
  if (pass.length < 6){ showErr('New password must be at least 6 characters.'); return; }
  busy(el('rsBtn'), 'Saving…', async function(){
    var r = await auth.resetPassword(pendingEmail, code, pass);
    if (r.ok) showReady(); else showErr(r.error);
  });
}
el('rsBtn').onclick = doReset;
el('rsPass').addEventListener('keydown', function(e){ if (e.key === 'Enter') doReset(); });
el('rsResend').onclick = function(){
  if (this.classList.contains('disabled')) return;
  startCooldown(30);
  auth.forgot(pendingEmail).then(function(r){ if (!r.ok) showErr(r.error); else showErr(''); });
};

/* ---------- ready / play / sign out ---------- */
var enterTimer = null;
function clearEnterTimer(){ if (enterTimer){ clearTimeout(enterTimer); enterTimer = null; } }
function startPlay(){
  clearErr();
  stopPoll();
  var b = el('playBtn'); b.disabled = true; b.textContent = 'Entering…';
  console.info('[join] entering the maze…');
  auth.accessToken().then(function(token){
    if (!token){ resetPlay(); showErr('Your session expired — please sign in again.'); show('signin'); return; }
    clearEnterTimer();
    // safety net: if we don't actually enter within 10s, stop hanging and offer a retry
    enterTimer = setTimeout(function(){
      console.warn('[join] timed out after 10s waiting for the server');
      enterTimer = null;
      var btn = el('playBtn'); btn.disabled = false; btn.textContent = 'Retry';
      showErr("Connection failed — the server didn't respond. Check your connection and retry.");
      if (document.exitPointerLock) document.exitPointerLock();
    }, 10000);
    enterMaze(token);
  });
}
el('playBtn').onclick = startPlay;
el('signoutLink').onclick = function(){ clearEnterTimer(); auth.signOut(); show('signin'); };

// we actually entered (game.js's 'round' handler ran) -> cancel the timeout
net.on('round', function(){ clearEnterTimer(); });

/* ---------- server rejected the join ---------- */
net.on('authError', function(m){
  clearEnterTimer();
  document.getElementById('ovStart').classList.remove('hide');
  showReady();
  showErr((m && m.message) || 'Could not join — sign in again.');
});

// The socket closed. Either the round ended (the server returns EVERYONE to the
// entrance to rejoin) or we dropped. Return to the home screen cleanly; only
// surface an error for an unexpected mid-game drop, not a clean round-end kick.
net.on('close', function(ev){
  clearEnterTimer();
  var displaced = ev && ev.code === 4001;             // took over by another device/browser
  var droppedMidGame = state.phase === 'playing';
  document.getElementById('ovStart').classList.remove('hide');
  document.getElementById('ovWin').classList.add('hide');
  document.getElementById('ovDeath').classList.add('hide');
  state.phase = 'menu';
  resetPlay();
  if (auth.user()) showReady();
  if (displaced) showErr('You are now playing on another device or browser — this session ended.');
  else if (droppedMidGame) showErr('Lost connection to the server — retry.');
  else showErr('');
});

// a server-event handler threw -> surface it instead of an infinite ENTERING
net.onError = function(type, e){
  if (state.phase !== 'playing'){
    clearEnterTimer();
    document.getElementById('ovStart').classList.remove('hide');
    resetPlay();
    showReady();
    showErr('Something went wrong entering the maze (' + type + '). Please retry.');
  }
};

resendLinks = [el('otpResend'), el('rsResend')];

/* ---------- boot ---------- */
(async function(){
  for (var k in panels) panels[k].classList.add('hide');   // avoid flashing the wrong panel
  await auth.init();
  if (!auth.configured){ showErr(auth.configError || 'Accounts are unavailable right now.'); return; }
  if (auth.user()) showReady(); else show('signin');
})();
