// Payment configuration from env vars ONLY (never committed). Payments are OFF
// unless PAYMENTS_ENABLED=1 AND all four credentials are present.
import { DEPOSIT_MIN_DEFAULT, WITHDRAW_MIN_DEFAULT, WITHDRAW_DAILY_CAP_DEFAULT } from '../../shared/payments.js';

function intEnv(name, def){ var v = parseInt(process.env[name], 10); return isFinite(v) ? v : def; }
function strip(u){ return (u || '').replace(/\/+$/, ''); }

export function paymentConfig(){
  var enabled = process.env.PAYMENTS_ENABLED === '1';
  var base = process.env.UNIPESA_API_BASE || '';
  var publicId = process.env.UNIPESA_PUBLIC_ID || '';
  var merchantId = process.env.UNIPESA_MERCHANT_ID || '';
  var secret = process.env.UNIPESA_SECRET_KEY || '';

  var missing = [];
  if (!base) missing.push('UNIPESA_API_BASE');
  if (!publicId) missing.push('UNIPESA_PUBLIC_ID');
  if (!merchantId) missing.push('UNIPESA_MERCHANT_ID');
  if (!secret) missing.push('UNIPESA_SECRET_KEY');

  return {
    enabled: enabled,
    base: strip(base), publicId: publicId, merchantId: merchantId, secret: secret,
    publicUrl: strip(process.env.PUBLIC_URL || ''),   // for the callback_url; else derived from the request
    missing: missing,
    ready: enabled && missing.length === 0,
    depositMin: intEnv('DEPOSIT_MIN', DEPOSIT_MIN_DEFAULT),
    withdrawMin: intEnv('WITHDRAW_MIN', WITHDRAW_MIN_DEFAULT),
    withdrawDailyCap: intEnv('WITHDRAW_DAILY_CAP', WITHDRAW_DAILY_CAP_DEFAULT)
  };
}

// Log the payments status once at boot (clear error if enabled-but-misconfigured).
export function logPaymentStatus(cfg){
  if (!cfg.enabled){ console.log('[payments] OFF (PAYMENTS_ENABLED != 1) — game runs normally.'); return; }
  if (cfg.missing.length){
    console.error('[payments] ENABLED but DISABLED: missing env var(s): ' + cfg.missing.join(', ') +
      ' — payments stay OFF until set.');
    return;
  }
  console.log('[payments] ON via Unipesa (' + cfg.base + '), deposit min ' + cfg.depositMin +
    ', withdraw min ' + cfg.withdrawMin + ', daily cap ' + cfg.withdrawDailyCap + '.');
}
