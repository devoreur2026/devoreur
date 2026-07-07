// Client-side Supabase auth (GoTrue REST via fetch — no SDK to vendor). Handles
// signup (email+password+display name, confirmed by an emailed OTP code), sign in,
// resend, password reset via OTP, session persistence + auto-refresh, and maps
// Supabase errors to human messages. Config (project URL + publishable anon key)
// comes from the server's /api/config so nothing is hard-coded.
var STORE = 'devoreur.session';
var cfg = null;                 // { url, key }
var session = null;             // { access_token, refresh_token, expires_at, user:{id,email,name} }
var refreshTimer = null;

function load(){
  try {
    var v = localStorage.getItem(STORE);
    if (v == null){                                   // one-time migration from the retired key
      var old = localStorage.getItem('umbra.session');
      if (old != null){ localStorage.setItem(STORE, old); localStorage.removeItem('umbra.session'); v = old; }
    }
    return JSON.parse(v || 'null');
  } catch (e) { return null; }
}
function persist(){ try { session ? localStorage.setItem(STORE, JSON.stringify(session)) : localStorage.removeItem(STORE); } catch (e) {} }

function userFrom(u){
  var meta = (u && u.user_metadata) || {};
  return { id: u && u.id, email: u && u.email, name: (meta.display_name || meta.name || meta.full_name || (u && u.email || '').split('@')[0] || 'Player') };
}
function setSession(data){
  var now = Math.floor(Date.now() / 1000);
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || (now + (data.expires_in || 3600)),
    user: userFrom(data.user)
  };
  persist();
  scheduleRefresh();
}
function clearSession(){ session = null; persist(); if (refreshTimer){ clearTimeout(refreshTimer); refreshTimer = null; } }

function scheduleRefresh(){
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!session) return;
  var ms = Math.max(1000, (session.expires_at - Math.floor(Date.now() / 1000) - 60) * 1000);
  refreshTimer = setTimeout(function(){ refresh(); }, Math.min(ms, 0x7fffffff));
}

async function api(path, opts){
  opts = opts || {};
  var headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  var res, data = null;
  try {
    res = await fetch(cfg.url + '/auth/v1' + path, {
      method: opts.method || 'POST', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch (e) { return { ok: false, error: 'Erreur réseau — vérifiez votre connexion.' }; }
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) return { ok: false, status: res.status, error: mapError(data, res.status) };
  return { ok: true, data: data };
}

function mapError(d, status){
  var code = (d && (d.error_code || d.error || d.code)) || '';
  var msg = ('' + ((d && (d.msg || d.error_description || d.message)) || '')).toLowerCase();
  if (typeof code === 'number') code = '';
  if (code === 'invalid_credentials' || msg.indexOf('invalid login') >= 0) return 'E-mail ou mot de passe incorrect.';
  if (code === 'user_already_exists' || code === 'email_exists' || msg.indexOf('already registered') >= 0 || msg.indexOf('already been registered') >= 0)
    return 'Cet e-mail est déjà inscrit — connectez-vous plutôt.';
  if (code === 'otp_expired' || code === 'otp_disabled' || (msg.indexOf('token') >= 0 && (msg.indexOf('expired') >= 0 || msg.indexOf('invalid') >= 0)) || msg.indexOf('otp') >= 0)
    return 'Ce code est incorrect ou a expiré.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429 || msg.indexOf('rate limit') >= 0 || msg.indexOf('too many') >= 0)
    return 'Trop de tentatives — patientez quelques minutes et réessayez.';
  if (code === 'weak_password' || msg.indexOf('password should be') >= 0 || msg.indexOf('at least 6') >= 0)
    return 'Mot de passe trop faible (au moins 6 caractères).';
  if (code === 'validation_failed' || msg.indexOf('unable to validate email') >= 0 || msg.indexOf('invalid email') >= 0 || msg.indexOf('invalid format') >= 0)
    return "Cet e-mail ne semble pas valide.";
  if (code === 'email_not_confirmed') return "Votre e-mail n'est pas encore vérifié — entrez le code envoyé.";
  if (code === 'signup_disabled') return 'Les inscriptions sont désactivées pour ce jeu.';
  return (d && (d.msg || d.error_description)) || 'Une erreur est survenue. Veuillez réessayer.';
}

async function refresh(){
  if (!session || !session.refresh_token) { clearSession(); return null; }
  var r = await api('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
  if (!r.ok){ clearSession(); return null; }
  setSession(r.data);
  return session.access_token;
}

export var auth = {
  configured: false,
  configError: null,
  oauthError: null,

  async init(){
    try {
      var res = await fetch('/api/config', { cache: 'no-store' });
      var c = await res.json();
      if (c && c.supabaseUrl && c.supabaseAnonKey){ cfg = { url: c.supabaseUrl.replace(/\/+$/, ''), key: c.supabaseAnonKey }; this.configured = true; }
      else this.configError = 'Comptes indisponibles — la configuration Supabase du serveur est manquante.';
    } catch (e) {
      this.configError = 'Impossible de joindre le serveur.';
    }
    if (!this.configured) return;
    await this._completeOAuth();          // finish a Google redirect if we came back with tokens
    session = load();
    if (session){
      // keep us signed in across reloads (~30 days, governed by Supabase)
      if (session.expires_at - Math.floor(Date.now() / 1000) < 60) await refresh();
      else scheduleRefresh();
    }
  },

  user(){ return session ? session.user : null; },
  async accessToken(){ if (!session) return null; if (session.expires_at - Math.floor(Date.now() / 1000) < 60) return await refresh(); return session.access_token; },

  async signUp(email, password, displayName){
    return await api('/signup', { body: { email: email, password: password, data: { display_name: displayName } } });
  },
  async verifySignup(email, code){
    var r = await api('/verify', { body: { type: 'signup', email: email, token: code } });
    if (r.ok) setSession(r.data);
    return r;
  },
  async resendSignup(email){ return await api('/resend', { body: { type: 'signup', email: email } }); },
  async signIn(email, password){
    var r = await api('/token?grant_type=password', { body: { email: email, password: password } });
    if (r.ok) setSession(r.data);
    return r;
  },
  // OAuth (Google, etc.): full-page redirect to Supabase's provider flow, which
  // sends us back to the app with the session tokens in the URL fragment.
  oauth(provider){
    if (!cfg) return;
    var redirect = window.location.origin + window.location.pathname;
    window.location.href = cfg.url + '/auth/v1/authorize?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(redirect);
  },
  async _completeOAuth(){
    var hash = window.location.hash || '';
    if (hash.indexOf('access_token=') < 0 && hash.indexOf('error=') < 0) return;
    var p = new URLSearchParams(hash.replace(/^#/, ''));
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}   // strip tokens from the URL
    if (p.get('error')){
      var d = (p.get('error_description') || '').toLowerCase();
      this.oauthError = (p.get('error') === 'access_denied' || d.indexOf('cancel') >= 0)
        ? 'Connexion Google annulée.' : 'Connexion Google impossible — réessayez.';
      return;
    }
    var at = p.get('access_token');
    if (!at) return;
    var u = await api('/user', { method: 'GET', token: at });   // fetch the profile to build the session
    if (!u.ok){ this.oauthError = 'Connexion Google impossible — réessayez.'; return; }
    setSession({ access_token: at, refresh_token: p.get('refresh_token'), expires_in: parseInt(p.get('expires_in'), 10) || 3600, user: u.data });
  },
  async forgot(email){ return await api('/recover', { body: { email: email } }); },
  async resetPassword(email, code, newPassword){
    var v = await api('/verify', { body: { type: 'recovery', email: email, token: code } });
    if (!v.ok) return v;
    setSession(v.data);
    var u = await api('/user', { method: 'PUT', token: session.access_token, body: { password: newPassword } });
    return u.ok ? { ok: true } : u;
  },
  signOut(){ clearSession(); }
};
