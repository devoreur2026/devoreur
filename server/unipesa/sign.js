// Unipesa request/callback signing — HMAC-SHA512, lowercase hex.
//
// Per the gateway docs (their PHP example): concatenate every param as
// key+value in the ORDER SENT, EXCLUDING the top-level `signature`; a nested
// object contributes `parent.child` + value recursively (dot-joined key path).
// Sign every outbound request; verify every inbound callback.
import crypto from 'crypto';

// Build the exact string that gets HMAC'd. Object key order = insertion order
// = "order sent". Only the TOP-LEVEL `signature` key is excluded (matching the
// PHP: the exclusion is in the outer loop, not inside the recursive flatten).
export function signatureBase(params){
  return build(params, '', true);
}
function build(obj, prefix, top){
  var s = '';
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++){
    var key = keys[i];
    if (top && key === 'signature') continue;      // exclude signature at the top level only
    var val = obj[key];
    var full = prefix + key;
    if (val !== null && typeof val === 'object'){   // nested object/array -> parent.child.
      s += build(val, full + '.', false);
    } else {
      s += full + (val == null ? '' : String(val));
    }
  }
  return s;
}

// Lowercase-hex HMAC-SHA512 of the signature base under the merchant secret.
export function signParams(params, secretKey){
  return crypto.createHmac('sha512', String(secretKey)).update(signatureBase(params), 'utf8').digest('hex');
}

// Verify an inbound payload's `signature` against a freshly computed one.
// Constant-time compare; any length/format mismatch is a rejection.
export function verifySignature(params, secretKey){
  var provided = params && params.signature;
  if (typeof provided !== 'string' || !provided) return false;
  var expected = signParams(params, secretKey);
  var a, b;
  try { a = Buffer.from(provided.toLowerCase(), 'utf8'); b = Buffer.from(expected, 'utf8'); }
  catch (e) { return false; }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Return a shallow copy of params with a correct `signature` attached.
export function withSignature(params, secretKey){
  var out = {};
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) if (keys[i] !== 'signature') out[keys[i]] = params[keys[i]];
  out.signature = signParams(out, secretKey);
  return out;
}
