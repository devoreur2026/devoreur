// Thin Unipesa HTTP client. Signs every outbound request; `fetch` is injectable
// so flows can be tested without touching the network.
import { withSignature } from './sign.js';
import { formatAmount, CURRENCY, COUNTRY, SIMULATOR_SUCCESS_CODE, STATUS } from '../../shared/payments.js';

export class UnipesaClient {
  constructor(config, fetchImpl){ this.cfg = config; this.fetch = fetchImpl || globalThis.fetch; }
  url(path){ return this.cfg.base + '/' + this.cfg.publicId + '/' + path; }

  async post(path, params){
    var signed = withSignature(params, this.cfg.secret);
    var res = await this.fetch(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(signed)
    });
    var text = await res.text();
    var data; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { httpStatus: res.status, data: data };
  }

  // deposit (customer-to-business); amount is integer CDF, formatted at the boundary
  deposit(orderId, amount, providerId, phone, callbackUrl){
    return this.post('payment_c2b', {
      public_id: this.cfg.publicId, merchant_id: this.cfg.merchantId, order_id: orderId,
      amount: formatAmount(amount), currency: CURRENCY, country: COUNTRY,
      provider: providerId, phone: phone, callback_url: callbackUrl
    });
  }
  // withdrawal (business-to-customer)
  withdraw(orderId, amount, providerId, phone, callbackUrl){
    return this.post('payment_b2c', {
      public_id: this.cfg.publicId, merchant_id: this.cfg.merchantId, order_id: orderId,
      amount: formatAmount(amount), currency: CURRENCY, country: COUNTRY,
      provider: providerId, phone: phone, callback_url: callbackUrl
    });
  }
  status(orderId){
    return this.post('status', {
      public_id: this.cfg.publicId, merchant_id: this.cfg.merchantId, order_id: orderId
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
