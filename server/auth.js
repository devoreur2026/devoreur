// Server-side verification of the Supabase access token presented on the
// WebSocket join. Because "Confirm email" is ON and signup is completed with an
// OTP, an unverified user never receives a token at all — so a validly-signed,
// unexpired Supabase access token *is* a verified account. We verify it locally
// against the project's JWKS (ES256), with a fallback to the Supabase /user
// endpoint if local verification can't run (e.g. a transient JWKS fetch issue).
import { createRemoteJWKSet, jwtVerify } from 'jose';

var SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
// NEW publishable key (browser-safe). Falls back to the legacy anon key so the
// cutover can't break auth mid-migration; warn loudly while legacy is in use.
var SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
if (!SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_ANON_KEY){
  SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY;
  console.warn('[auth] using LEGACY SUPABASE_ANON_KEY — set SUPABASE_PUBLISHABLE_KEY and disable the legacy key.');
}

export function authConfigured(){ return !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY); }
// `anonKey` is the wire field the browser Supabase client reads; a publishable
// key is a drop-in replacement for the anon key there.
export function authConfig(){ return { url: SUPABASE_URL, anonKey: SUPABASE_PUBLISHABLE_KEY }; }

var _jwks = null;
function jwks(){
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(SUPABASE_URL + '/auth/v1/.well-known/jwks.json'));
  return _jwks;
}

export function AuthError(msg){ this.name = 'AuthError'; this.message = msg; }
AuthError.prototype = Object.create(Error.prototype);

function nameFrom(meta, email){
  var n = (meta && (meta.display_name || meta.name || meta.full_name)) || (email || '').split('@')[0] || 'Player';
  return ('' + n).slice(0, 16).trim() || 'Player';
}

// Resolve a token to { sub, email, name } or throw AuthError.
export async function verifyToken(token){
  if (!authConfigured()) throw new AuthError('Comptes indisponibles pour le moment.');
  if (!token || typeof token !== 'string') throw new AuthError('Connectez-vous pour jouer.');

  // Primary: local JWKS verification (fast, offline after first fetch).
  try {
    var out = await jwtVerify(token, jwks(), {
      issuer: SUPABASE_URL + '/auth/v1',
      audience: 'authenticated'
    });
    var p = out.payload;
    return { sub: p.sub, email: p.email, name: nameFrom(p.user_metadata, p.email) };
  } catch (e) {
    // Fallback: ask Supabase directly (covers transient JWKS issues).
    return await verifyViaApi(token);
  }
}

async function verifyViaApi(token){
  var res;
  try {
    res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
    });
  } catch (e) {
    throw new AuthError("Impossible de joindre le serveur d'authentification. Réessayez.");
  }
  if (!res.ok) throw new AuthError('Votre session est invalide ou expirée — reconnectez-vous.');
  var u = await res.json();
  if (!u || (!u.email_confirmed_at && !u.confirmed_at)) throw new AuthError('Vérifiez votre e-mail avant de jouer.');
  return { sub: u.id, email: u.email, name: nameFrom(u.user_metadata, u.email) };
}
