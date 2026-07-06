// Unit tests for every economy path. Run: node test/economy.test.mjs
import { Bank } from '../server/bank.js';
import {
  CREDIT, EARNINGS, HOUSE, POT, ENTRY_BASE, ENTRY_PER_MINUTE, entryPrice, KILL_PENALTY, BONUS_POT,
  FIREBALL_PACK, FIREBALL_PACK_PRICE
} from '../shared/economy.js';

var passed = 0, failed = 0;
function ok(cond, msg){ if (cond){ passed++; } else { failed++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg){ ok(a === b, msg + '  (got ' + a + ', want ' + b + ')'); }
function section(name){ console.log('— ' + name); }
// after any bank op the derived balances must equal the row sums, and no round leaks money
function invariants(bank, round){
  ok(bank.ledger.verifyIntegrity(), 'integrity: balances == ledger sum');
  if (round !== undefined) eq(bank.auditRound(round), 0, 'audit: round ' + round + ' nets to zero');
}

/* ---------- grant (dev) ---------- */
section('grant (dev)');
{
  var b = new Bank();
  b.grant('A', 5000, 'g1');
  eq(b.wallet('A').credit, 5000, 'grant adds credit');
  b.grant('A', 5000, 'g1');                       // idempotent replay
  eq(b.wallet('A').credit, 5000, 'grant is idempotent (double-click safe)');
  eq(b.ledger.balance('mint', CREDIT), -5000, 'mint tracks money created');
  invariants(b);
}

/* ---------- entry fee + rake/pot split ---------- */
section('entry');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA');
  var r = b.enterRound('A', 'r1', ENTRY_BASE);
  ok(r.ok, 'entry succeeds when affordable');
  eq(b.wallet('A').credit, 4000, 'entry debits 1000');
  eq(b.houseBalance(), 300, 'rake is 30% (300)');
  eq(b.potBalance('r1'), 700, 'pot gets 70% (700)');
  eq(300 + 700, ENTRY_BASE, 'split sums to the fee');
  var r2 = b.enterRound('A', 'r1', ENTRY_BASE);               // idempotent
  ok(r2.idempotent, 'entry is idempotent');
  eq(b.wallet('A').credit, 4000, 'no double charge on re-entry');
  // cannot afford
  b.grant('P', 500, 'gP');
  var r3 = b.enterRound('P', 'r1', ENTRY_BASE);
  ok(!r3.ok && r3.reason === 'insufficient', 'entry blocked when credit < fee');
  eq(b.wallet('P').credit, 500, 'blocked entry took nothing');
  invariants(b, 'r1');
}

/* ---------- fireball kill: 70% killer earnings, 30% pot, penalty capped, never negative ---------- */
section('fireball kill');
{
  var b = new Bank();
  b.grant('V', 1000, 'gV'); b.grant('K', 0, 'gK');
  var k = b.killByFireball('V', 'K', 'r1', 'kill1');
  eq(k.taken, KILL_PENALTY, 'takes up to 250');
  eq(b.wallet('V').credit, 750, 'victim credit reduced by 250');
  eq(b.wallet('K').earnings, 175, 'killer earnings +70% (175)');
  eq(b.potBalance('r1'), 75, 'pot +30% (75)');
  eq(k.toKiller + k.toPot, k.taken, 'split sums to taken');
  // victim with < 250 credit: take what exists, never negative
  b.grant('V2', 100, 'gV2');
  var k2 = b.killByFireball('V2', 'K', 'r1', 'kill2');
  eq(k2.taken, 100, 'takes only what the victim has');
  eq(b.wallet('V2').credit, 0, 'victim never goes negative');
  eq(b.wallet('V2').credit >= 0, true, 'credit stays >= 0');
  // odd amount rounds cleanly (101 -> 71 + 30)
  b.grant('V3', 101, 'gV3');
  var k3 = b.killByFireball('V3', 'K', 'r1', 'kill3');
  eq(k3.toKiller + k3.toPot, 101, 'odd split still sums exactly');
  // idempotent kill (no double penalty)
  var before = b.wallet('V').credit;
  b.killByFireball('V', 'K', 'r1', 'kill1');
  eq(b.wallet('V').credit, before, 'same killId does not double-charge');
  invariants(b, 'r1');
}

/* ---------- eater kill: 50% house, 50% pot ---------- */
section('eater kill');
{
  var b = new Bank();
  b.grant('V', 1000, 'gV');
  var k = b.killByEater('V', 'r1', 'ke1');
  eq(k.taken, 250, 'takes up to 250');
  eq(b.wallet('V').credit, 750, 'victim -250');
  eq(k.toHouse, 125, 'house +50% (125)');
  eq(k.toPot, 125, 'pot +50% (125)');
  eq(k.toHouse + k.toPot, k.taken, 'split sums to taken');
  // zero-credit victim: no money moves, still a valid kill
  b.grant('Z', 0, 'gZ');
  var kz = b.killByEater('Z', 'r1', 'ke2');
  eq(kz.taken, 0, 'no money taken from a broke victim');
  invariants(b, 'r1');
}

/* ---------- payout: <5 players => winner gets the pot ---------- */
section('payout <5 players');
{
  var b = new Bank();
  ['A', 'B', 'C'].forEach(function(p, i){ b.grant(p, 5000, 'g' + p); b.enterRound(p, 'r1', ENTRY_BASE); });
  var pot = b.potBalance('r1');
  eq(pot, 2100, 'pot = 3 * 700');
  var pay = b.payout('A', 'r1', 3);
  eq(pay.target, pot, 'winner receives the pot');
  eq(pay.topup, 0, 'no house top-up under 5 players');
  eq(b.wallet('A').earnings, 2100, 'winner earnings credited');
  eq(b.potBalance('r1'), 0, 'pot drained');
  invariants(b, 'r1');
}

/* ---------- payout: 5+ players => guaranteed 10000, house tops up ---------- */
section('payout 5+ players (bonus + top-up)');
{
  var b = new Bank();
  ['A', 'B', 'C', 'D', 'E'].forEach(function(p){ b.grant(p, 5000, 'g' + p); b.enterRound(p, 'r1', ENTRY_BASE); });
  var pot = b.potBalance('r1');
  eq(pot, 3500, 'pot = 5 * 700');
  var houseBefore = b.houseBalance();
  eq(houseBefore, 1500, 'house has the rake (5 * 300)');
  var pay = b.payout('A', 'r1', 5);
  eq(pay.target, BONUS_POT, 'winner guaranteed 10000');
  eq(pay.topup, BONUS_POT - pot, 'house tops up the gap (6500)');
  eq(b.wallet('A').earnings, BONUS_POT, 'winner earnings = 10000');
  eq(b.houseBalance(), houseBefore - pay.topup, 'house paid the top-up (goes negative)');
  eq(b.potBalance('r1'), 0, 'pot drained');
  invariants(b, 'r1');

  // 5+ but pot already exceeds the bonus => winner gets the (bigger) pot, no top-up
  var b2 = new Bank();
  var many = 20;                                    // 20 * 700 = 14000 pot
  for (var i = 0; i < many; i++){ var p = 'X' + i; b2.grant(p, 5000, 'g' + p); b2.enterRound(p, 'r2', ENTRY_BASE); }
  var pot2 = b2.potBalance('r2');
  ok(pot2 > BONUS_POT, 'pot exceeds 10000 (got ' + pot2 + ')');
  var pay2 = b2.payout('X0', 'r2', many);
  eq(pay2.target, pot2, 'winner gets the full (larger) pot');
  eq(pay2.topup, 0, 'no top-up when pot already exceeds bonus');
  invariants(b2, 'r2');
}

/* ---------- shop: buy fireballs, inventory persists, insufficient, idempotent ---------- */
section('shop / fireballs');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA');
  var s = b.buyFireballs('A', 1, 'n1');
  eq(s.cost, FIREBALL_PACK_PRICE, 'pack costs 100');
  eq(b.fireballs('A'), FIREBALL_PACK, 'got 10 fireballs');
  eq(b.wallet('A').credit, 4900, 'credit debited 100');
  b.buyFireballs('A', 1, 'n1');                    // idempotent (double-click)
  eq(b.fireballs('A'), FIREBALL_PACK, 'no double purchase on same nonce');
  eq(b.wallet('A').credit, 4900, 'no double charge');
  b.buyFireballs('A', 2, 'n2');
  eq(b.fireballs('A'), 30, 'two more packs -> 30');
  // consume
  b.consumeFireball('A', 't1');
  eq(b.fireballs('A'), 29, 'throw consumes one');
  b.consumeFireball('A', 't1');                    // idempotent per throwId
  eq(b.fireballs('A'), 29, 'same throwId does not double-consume');
  // insufficient
  b.grant('P', 50, 'gP');
  var bad = b.buyFireballs('P', 1, 'np');
  ok(!bad.ok && bad.reason === 'insufficient', 'buy blocked when credit < cost');
  // empty inventory
  var em = b.consumeFireball('P', 'te');
  ok(!em.ok && em.reason === 'empty', 'cannot throw with no fireballs');
  invariants(b);
}

/* ---------- transfer earnings -> credit ---------- */
section('transfer earnings -> credit');
{
  var b = new Bank();
  b.grant('V', 1000, 'gV');
  b.killByFireball('V', 'A', 'r1', 'k1');          // A earns 175
  eq(b.wallet('A').earnings, 175, 'A has earnings');
  var t = b.transfer('A', 100, 'x1');
  ok(t.ok, 'transfer succeeds');
  eq(b.wallet('A').earnings, 75, 'earnings reduced');
  eq(b.wallet('A').credit, 100, 'credit increased');
  b.transfer('A', 100, 'x1');                       // idempotent
  eq(b.wallet('A').credit, 100, 'transfer idempotent');
  var over = b.transfer('A', 999, 'x2');
  ok(!over.ok && over.reason === 'insufficient', 'cannot transfer more than earnings');
  invariants(b);
}

/* ---------- refund on abort: everyone made whole, audit stays zero ---------- */
section('refund on abort');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA'); b.grant('B', 5000, 'gB');
  b.enterRound('A', 'ra', ENTRY_BASE); b.enterRound('B', 'ra', ENTRY_BASE);
  b.killByFireball('B', 'A', 'ra', 'k1');           // mid-round kill
  ok(b.potBalance('ra') > 0, 'round has money in flight');
  var res = b.abortRound('ra');
  ok(res.ok, 'abort succeeds');
  eq(b.wallet('A').credit, 5000, 'A fully refunded');
  eq(b.wallet('B').credit, 5000, 'B fully refunded');
  eq(b.wallet('A').earnings, 0, 'kill reward reversed');
  eq(b.potBalance('ra'), 0, 'pot voided');
  eq(b.houseBalance(), 0, 'house rake reversed');
  eq(b.auditRound('ra'), 0, 'aborted round nets to zero');
  b.abortRound('ra');                               // idempotent
  eq(b.wallet('A').credit, 5000, 'abort idempotent');
  invariants(b, 'ra');
}

/* ---------- full round end-to-end audit == 0 ---------- */
section('full round audit');
{
  var b = new Bank();
  var players = ['A', 'B', 'C', 'D', 'E', 'F'];
  players.forEach(function(p){ b.grant(p, 5000, 'g' + p); b.enterRound(p, 'R', ENTRY_BASE); });
  b.killByFireball('B', 'A', 'R', 'k1');
  b.killByEater('C', 'R', 'k2');
  b.killByFireball('D', 'A', 'R', 'k3');
  b.payout('A', 'R', players.length);
  eq(b.auditRound('R'), 0, 'entries + kills + payout net to exactly zero');
  ok(b.ledger.verifyIntegrity(), 'ledger integrity holds across a full round');
  // no wallet is negative
  var neg = false;
  players.forEach(function(p){ if (b.wallet(p).credit < 0 || b.wallet(p).earnings < 0) neg = true; });
  ok(!neg, 'no player balance is ever negative');
}

/* ---------- rising entry price ---------- */
section('rising entry price');
{
  eq(entryPrice(0), ENTRY_BASE, 'minute 0 = base (1000)');
  eq(entryPrice(59), ENTRY_BASE, '0:59 still base');
  eq(entryPrice(60), ENTRY_BASE + ENTRY_PER_MINUTE, '1:00 = 1050');
  eq(entryPrice(300), ENTRY_BASE + 5 * ENTRY_PER_MINUTE, '5:00 = 1250');
  // a late entry charges the higher price and still splits 30/70 exactly
  var b = new Bank();
  b.grant('L', 5000, 'gL');
  var price = entryPrice(300);                       // 1250
  var r = b.enterRound('L', 'rP', price);
  eq(r.price, price, 'charged the late price');
  eq(b.wallet('L').credit, 5000 - price, 'debited the late price');
  eq(b.houseBalance(), Math.round(price * 0.30), 'rake = 30% of late price (375)');
  eq(b.potBalance('rP'), price - Math.round(price * 0.30), 'pot = rest (875)');
  eq(b.houseBalance() + b.potBalance('rP'), price, 'split sums to the late price');
  invariants(b, 'rP');
}

/* ---------- pot rollover: unclaimed pot -> next round, audits stay zero ---------- */
section('pot rollover');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA'); b.grant('B', 5000, 'gB');
  b.enterRound('A', 'R1', ENTRY_BASE); b.enterRound('B', 'R1', ENTRY_BASE);
  var potR1 = b.potBalance('R1');
  eq(potR1, 1400, 'R1 pot = 1400 (no winner, time limit hit)');

  var carried = b.rollover('R1', 'R2');             // R1 expired unclaimed
  eq(carried, 1400, 'entire pot rolls over');
  eq(b.potBalance('R1'), 0, 'R1 pot emptied');
  eq(b.potBalance('R2'), 1400, "R2 starts with R1's pot (no extra house cut)");
  eq(b.houseBalance(), 600, 'house unchanged by rollover (still just the rake)');
  eq(b.auditRound('R1'), 0, 'expired round R1 still audits to zero');
  eq(b.auditRound('R2'), 0, 'rollover legs net to zero within R2');

  // play R2 to a win: pot = 1400 rolled + new entries, winner takes it, audit 0
  b.enterRound('A', 'R2', ENTRY_BASE); b.enterRound('B', 'R2', ENTRY_BASE);
  eq(b.potBalance('R2'), 1400 + 1400, 'R2 pot = rollover + new entries');
  b.payout('A', 'R2', 2);
  eq(b.wallet('A').earnings, 2800, 'winner takes the grown pot');
  eq(b.potBalance('R2'), 0, 'R2 pot drained');
  eq(b.auditRound('R2'), 0, 'R2 (rollover + entries + payout) nets to zero');
  b.rollover('R1', 'R2');                            // idempotent
  eq(b.potBalance('R2'), 0, 'rollover is idempotent');
  ok(b.ledger.verifyIntegrity(), 'ledger integrity holds through a rollover');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
