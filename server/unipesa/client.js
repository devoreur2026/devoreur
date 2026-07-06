// Thin Unipesa HTTP client. Signs every outbound request; `fetch` is injectable
// so flows can be tested without touching the network.
import { withSignature } from './sign.js';
import { formatAmount, CURRENCY, COUNTRY, SIMULATOR_SUCCESS_CODE, STATUS } from '../../shared/payments.js';

export class UnipesaClient {
  constructor(config, fetchImpl){ this.cfg = config; this.fetch = fetchImpl || globalThis.fetch; }
  url(path){ return this.cfg.base + '/' + this.cfg.publicId + '/' + path; }

  async post(path, params){
    var signed = withSignature(params, this.cfg.secret);
    var url = this.url(path);
    // full outgoing request logged for real-payment debugging (signature is a
    // hash; the secret key is never a param, so nothing sensitive leaks)
    console.log('[unipesa] -> POST ' + url + '\n  body: ' + JSON.stringify(signed));
    var res, text;
    try {
      res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(signed)
      });
      text = await res.text();
    } catch (e) {
      console.error('[unipesa] <- NETWORK ERROR for ' + path + ': ' + (e && e.message));
      throw e;
    }
    console.log('[unipesa] <- ' + res.status + ' ' + String(text).slice(0, 2000));
    var data; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { httpStatus: res.status, data: data };
  }

  // deposit (customer-to-business). EXACT v5.7.2 doc fields, in doc order:
  // merchant_id, customer_id(=phone), order_id, amount(string), currency,
  // country, callback_url, provider_id(int), signature. public_id is in the URL.
  deposit(orderId, amount, providerId, phone, callbackUrl){
    return this.post('payment_c2b', {
      merchant_id: this.cfg.merchantId,
      customer_id: phone,
      order_id: orderId,
      amount: formatAmount(amount),
      currency: CURRENCY,
      country: COUNTRY,
      callback_url: callbackUrl,
      provider_id: providerId
    });
  }
  // withdrawal (business-to-customer) — same field convention as C2B
  withdraw(orderId, amount, providerId, phone, callbackUrl){
    return this.post('payment_b2c', {
      merchant_id: this.cfg.merchantId,
      customer_id: phone,
      order_id: orderId,
      amount: formatAmount(amount),
      currency: CURRENCY,
      country: COUNTRY,
      callback_url: callbackUrl,
      provider_id: providerId
    });
  }
  status(orderId){
    return this.post('status', {
      merchant_id: this.cfg.merchantId,
      order_id: orderId
    });
  }
}

// Read a Unipesa transaction status out of a response/callback body, tolerant to
// a few shapes. Simulator success comes as provider_result.code === -8888.
export function readStatus(data){
  if (!data || typeof data !== 'object') return null;
  if (data.provider_result && data.provider_result.code === SIMULATOR_SUCCESS_CODE) return STATUS.SUCCESS;
  if (typeof data.status === 'number') return data.status;
  if (data.transaction && typeof data.transaction.status === 'number') return data.transaction.status;
  if (data.data && typeof data.data.status === 'number') return data.data.status;
  return null;
}
export function readConfirmType(data){
  if (!data || typeof data !== 'object') return 0;
  if (typeof data.confirm_type === 'number') return data.confirm_type;
  if (data.transaction && typeof data.transaction.confirm_type === 'number') return data.transaction.confirm_type;
  return 0;
}
export function readMessage(data){
  if (!data || typeof data !== 'object') return null;
  return data.message || data.status_message || (data.provider_result && data.provider_result.message) || null;
}
