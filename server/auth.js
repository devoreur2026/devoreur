// Server-side verification of the Supabase access token presented on the
// WebSocket join. Because "Confirm email" is ON and signup is completed with an
// OTP, an unverified user never receives a token at all — so a validly-signed,
// unexpired Supabase access token *is* a verified account. We verify it locally
// against the project's JWKS (ES256), with a fallback to the Supabase /user
// endpoint if local verification can't run (e.g. a transient JWKS fetch issue).
import { createRemoteJWKSet, jwtVerify } from 'jose';

var SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
var SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export function authConfigured(){ return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }
export function authConfig(){ return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }; }

var _jwks = null;
function jwks(){
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(SUPABASE_URL + '/auth/v1/.well-known/jwks.json'));
  return _jwks;
}

export function AuthError(msg){ this.name = 'AuthError'; this.message = msg; }
AuthError.prototype = Object.create(Error.prototype);

function nameFrom(meta, email){
  var n = (meta && (meta.display_name || meta.name)) || (email || '').split('@')[0] || 'Player';
  return ('' + n).slice(0, 16).trim() || 'Player';
}

// Resolve a token to { sub, email, name } or throw AuthError.
export async function verifyToken(token){
  if (!authConfigured()) throw new AuthError('Accounts are not available right now.');
  if (!token || typeof token !== 'string') throw new AuthError('Please sign in to play.');

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
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
  } catch (e) {
    throw new AuthError('Could not reach the auth server. Try again.');
  }
  if (!res.ok) throw new AuthError('Your session is invalid or expired — sign in again.');
  var u = await res.json();
  if (!u || (!u.email_confirmed_at && !u.confirmed_at)) throw new AuthError('Verify your email before playing.');
  return { sub: u.id, email: u.email, name: nameFrom(u.user_metadata, u.email) };
}
