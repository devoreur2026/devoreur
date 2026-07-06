// Process-wide payments singleton, wired to the shared Bank. Config comes from
// env (payments OFF unless PAYMENTS_ENABLED=1 and all credentials are present).
import { paymentConfig, logPaymentStatus } from './unipesa/config.js';
import { PaymentStore } from './paymentStore.js';
import { UnipesaClient } from './unipesa/client.js';
import { Payments } from './payments.js';
import { bank } from './bankInstance.js';

export var paymentConfigObj = paymentConfig();
export var paymentStore = new PaymentStore();
var client = new UnipesaClient(paymentConfigObj);
export var payments = new Payments({ bank: bank, store: paymentStore, client: client, config: paymentConfigObj });
export { logPaymentStatus };
