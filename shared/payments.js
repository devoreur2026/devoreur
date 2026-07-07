// Payment domain constants + pure helpers shared by client and server.
// NOTHING secret here (no keys) — the provider list, phone normalization,
// amount formatting, and status codes. The HMAC signing lives server-side only.

// The real DRC providers enabled on our Unipesa account (the numeric `provider_id`
// the gateway expects), each with its required phone format. No test/simulator
// provider is selectable in production — provider_id 14 would self-credit.
export var PROVIDERS = [
  { key: 'vodacom',  id: 9,  label: 'Vodacom M-Pesa', hint: '243XXXXXXXXX (indicatif pays, sans 0 initial)' },
  { key: 'orange',   id: 10, label: 'Orange Money',   hint: '0XXXXXXXXX (commence par 0)' },
  { key: 'airtel',   id: 17, label: 'Airtel Money',   hint: '99XXXXXXX (sans 0 initial)' },
  { key: 'africell', id: 19, label: 'Africell Money', hint: '09XXXXXXXX (commence par 0)' }
];
export function providerByKey(key){ for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].key === key) return PROVIDERS[i]; return null; }
export function providerById(id){ for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i]; return null; }

// Reduce any DRC input to the 9-digit national number (no country code, no
// leading 0): 243XXXXXXXXX, 0XXXXXXXXX, or XXXXXXXXX all -> XXXXXXXXX.
export function toNational(raw){
  var d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.length >= 12 && d.slice(0, 3) === '243') d = d.slice(3);
  if (d.length === 10 && d[0] === '0') d = d.slice(1);
  return d;
}

// Per-provider phone shape sent to the gateway:
//   Vodacom  -> 243XXXXXXXXX  (country code, no leading 0)
//   Orange   -> 0XXXXXXXXX    (leading 0, 10 digits)
//   Airtel   -> XXXXXXXXX     (no leading 0, 9 digits, e.g. 99XXXXXXX)
//   Africell -> 0XXXXXXXXX    (leading 0, 10 digits)
function shape(key, nat){
  if (key === 'vodacom') return '243' + nat;
  if (key === 'orange' || key === 'africell') return '0' + nat;
  return nat;                                   // airtel: bare national
}
// Normalize + validate a phone for a provider. Returns { ok, phone, reason }.
export function normalizePhone(providerKey, raw){
  var p = providerByKey(providerKey);
  if (!p) return { ok: false, reason: 'choisissez un opérateur mobile money' };
  var nat = toNational(raw);
  if (nat.length !== 9) return { ok: false, reason: 'entrez un numéro ' + p.label + ' valide : ' + p.hint };
  var phone = shape(providerKey, nat);
  var okShape = (providerKey === 'vodacom') ? /^243\d{9}$/.test(phone)
              : (providerKey === 'orange' || providerKey === 'africell') ? /^0\d{9}$/.test(phone)
              : /^\d{9}$/.test(phone);
  if (!okShape) return { ok: false, reason: 'ce numéro n\'est pas valide pour ' + p.label + ' (' + p.hint + ')' };
  return { ok: true, phone: phone };
}

// Integer CDF -> the API's two-decimal string. We keep integer CDF internally
// and only format at the API boundary.
export function formatAmount(cdf){ return (Math.round(cdf)).toFixed(2); }

export var CURRENCY = 'CDF';
export var COUNTRY = 'CD';

// Unipesa transaction statuses.
export var STATUS = { INITIATED: 0, IN_PROGRESS: 1, SUCCESS: 2, FAILED: 3, CANCELLED: 4, IN_TRANSIT: 6 };
export var STATUS_LABEL = {
  0: 'initié', 1: 'en cours', 2: 'réussi', 3: 'échoué', 4: 'annulé', 6: 'en transit'
};
export var SIMULATOR_SUCCESS_CODE = -8888;   // provider_result.code for a simulator success (direct response)

// Defaults (server may override via env). Amounts are integer CDF.
export var DEPOSIT_MIN_DEFAULT = 1000;
export var WITHDRAW_MIN_DEFAULT = 5000;
export var WITHDRAW_DAILY_CAP_DEFAULT = 200000;
