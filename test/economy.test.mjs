// Unit tests for every economy path. Run: node test/economy.test.mjs
import { Bank } from '../server/bank.js';
import {
  CREDIT, EARNINGS, HOUSE, POT, ENTRY_BASE, ENTRY_PER_MINUTE, ENTRY_MAX, entryPrice, STAKE_PER_LIFE, BONUS_POT,
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

/* ---------- entry is HELD as stake (4 lives), not split ---------- */
section('entry (staked = 4 lives)');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA');
  var r = b.enterRound('A', 'r1', ENTRY_BASE);
  ok(r.ok, 'entry succeeds when affordable');
  eq(b.wallet('A').credit, 4000, 'entry debits 1000 from Credit');
  eq(b.stakeBalance('A'), 1000, 'the 1000 is held as stake');
  eq(b.lives('A'), 4, '1000 stake = 4 lives (250 each)');
  eq(b.potBalance('r1'), 0, 'nothing goes to the pot at entry');
  var r2 = b.enterRound('A', 'r1', ENTRY_BASE);              // idempotent
  ok(r2.idempotent, 'entry is idempotent (reconnect to same round is free)');
  eq(b.wallet('A').credit, 4000, 'no double charge');
  eq(b.stakeBalance('A'), 1000, 'no double stake');
  b.grant('P', 500, 'gP');
  var r3 = b.enterRound('P', 'r1', ENTRY_BASE);
  ok(!r3.ok && r3.reason === 'insufficient', 'entry blocked when credit < fee');
  eq(b.wallet('P').credit, 500, 'blocked entry took nothing');
  invariants(b, 'r1');
}

/* ---------- fireball death spends 250 stake: 70% killer / 30% pot ---------- */
section('fireball death (from stake)');
{
  var b = new Bank();
  b.grant('V', 5000, 'gV'); b.grant('K', 0, 'gK');
  b.enterRound('V', 'r1', ENTRY_BASE);                      // V stakes 1000 (4 lives)
  var k = b.killByFireball('V', 'K', 'r1', 'kill1');
  eq(k.taken, STAKE_PER_LIFE, 'spends 250 of the stake (one life)');
  eq(b.stakeBalance('V'), 750, 'victim stake -250');
  eq(b.lives('V'), 3, 'victim down to 3 lives');
  eq(b.wallet('V').credit, 4000, 'Credit untouched — the stake pays');
  eq(b.wallet('K').earnings, 175, 'killer earnings +70% (175)');
  eq(b.potBalance('r1'), 75, 'pot +30% (75)');
  eq(k.toKiller + k.toPot, k.taken, 'split sums to 250');
  var before = b.stakeBalance('V');
  b.killByFireball('V', 'K', 'r1', 'kill1');
  eq(b.stakeBalance('V'), before, 'same killId does not double-spend');
  var kz = b.killByFireball('K', 'V', 'r1', 'killz');        // K never staked
  eq(kz.taken, 0, 'no stake -> nothing taken');
  invariants(b, 'r1');
}

/* ---------- eater death spends 250 stake: 50% house / 50% pot ---------- */
section('eater death (from stake)');
{
  var b = new Bank();
  b.grant('V', 5000, 'gV');
  b.enterRound('V', 'r1', ENTRY_BASE);
  var k = b.killByEater('V', 'r1', 'ke1');
  eq(k.taken, STAKE_PER_LIFE, 'spends 250 of the stake');
  eq(b.stakeBalance('V'), 750, 'stake -250');
  eq(k.toHouse, 125, 'house +50% (125)');
  eq(k.toPot, 125, 'pot +50% (125)');
  b.grant('Z', 0, 'gZ');
  var kz = b.killByEater('Z', 'r1', 'ke2');
  eq(kz.taken, 0, 'no stake -> nothing taken');
  invariants(b, 'r1');
}

/* ---------- lives run out + forfeit leftover stake to the pot ---------- */
section('lives + forfeit');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA'); b.grant('K', 0, 'gK');
  b.enterRound('A', 'r1', ENTRY_BASE);                      // 4 lives
  b.killByFireball('A', 'K', 'r1', 'k1'); b.killByFireball('A', 'K', 'r1', 'k2');
  b.killByFireball('A', 'K', 'r1', 'k3'); b.killByFireball('A', 'K', 'r1', 'k4');
  eq(b.lives('A'), 0, '4 deaths -> out of lives');
  eq(b.stakeBalance('A'), 0, 'stake fully spent');
  // buy another life-pack
  b.buyLives('A', 'r1', ENTRY_BASE, 'n1');
  eq(b.lives('A'), 4, 'buying a life-pack restores 4 lives');
  eq(b.wallet('A').credit, 3000, 'paid another 1000');
  // survive with lives left -> forfeit the rest 50/50 house/pot at round end
  b.killByFireball('A', 'K', 'r1', 'k5');                   // 1 death -> stake 750
  var potBefore = b.potBalance('r1'), houseBefore = b.houseBalance();
  var f = b.forfeitStake('A', 'r1');
  eq(b.stakeBalance('A'), 0, 'leftover stake forfeited');
  eq(f.toHouse, 375, 'half the 750 -> house'); eq(f.toPot, 375, 'half the 750 -> pot');
  eq(b.potBalance('r1'), potBefore + 375, 'half the leftover goes into the pot');
  eq(b.houseBalance(), houseBefore + 375, 'the other half goes to the house');
  b.forfeitStake('A', 'r1');                                // idempotent
  eq(b.stakeBalance('A'), 0, 'forfeit idempotent');
  invariants(b, 'r1');
}

/* ---------- payout: the guaranteed bonus floor applies to EVERY round ---------- */
section('payout: bonus floor even with few players');
{
  var b = new Bank();
  ['A', 'B', 'C'].forEach(function(p){ b.grant(p, 5000, 'g' + p); b.enterRound(p, 'r1', ENTRY_BASE); });
  ['A', 'B', 'C'].forEach(function(p){ b.forfeitStake(p, 'r1'); });   // round-end forfeit: half to pot
  var pot = b.potBalance('r1');
  eq(pot, 1500, 'pot = half of 3 forfeited stakes (3 * 500)');
  var pay = b.payout('A', 'r1', 3);
  eq(pay.target, BONUS_POT, 'winner gets the guaranteed bonus (15000) even with 3 players');
  eq(pay.topup, BONUS_POT - pot, 'house tops up the gap');
  eq(b.wallet('A').earnings, BONUS_POT, 'winner earnings = 15000');
  eq(b.potBalance('r1'), 0, 'pot drained');
  invariants(b, 'r1');
}

/* ---------- payout: guaranteed 15000, house tops up; a bigger pot wins ---------- */
section('payout: guaranteed 15000 + top-up / bigger pot');
{
  var b = new Bank();
  ['A', 'B', 'C', 'D', 'E'].forEach(function(p){ b.grant(p, 5000, 'g' + p); b.enterRound(p, 'r1', ENTRY_BASE); });
  ['A', 'B', 'C', 'D', 'E'].forEach(function(p){ b.forfeitStake(p, 'r1'); });
  var pot = b.potBalance('r1');
  eq(pot, 2500, 'pot = half of 5 forfeited stakes (5 * 500)');
  var houseBefore = b.houseBalance();
  var pay = b.payout('A', 'r1', 5);
  eq(pay.target, BONUS_POT, 'winner guaranteed 15000');
  eq(pay.topup, BONUS_POT - pot, 'house tops up the gap');
  eq(b.wallet('A').earnings, BONUS_POT, 'winner earnings = 15000');
  eq(b.houseBalance(), houseBefore - pay.topup, 'house paid the top-up (goes negative)');
  eq(b.potBalance('r1'), 0, 'pot drained');
  invariants(b, 'r1');

  // pot already exceeds the bonus => winner gets the (bigger) pot, no top-up
  var b2 = new Bank();
  var many = 40;                                    // 40 * 500 (half of each stake) = 20000 > 15000
  for (var i = 0; i < many; i++){ var p = 'X' + i; b2.grant(p, 5000, 'g' + p); b2.enterRound(p, 'r2', ENTRY_BASE); b2.forfeitStake(p, 'r2'); }
  var pot2 = b2.potBalance('r2');
  ok(pot2 > BONUS_POT, 'pot exceeds 15000 (got ' + pot2 + ')');
  var pay2 = b2.payout('X0', 'r2', many);
  eq(pay2.target, pot2, 'winner gets the full (larger) pot');
  eq(pay2.topup, 0, 'no top-up when pot already exceeds the bonus');
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
  b.grant('V', 5000, 'gV');
  b.enterRound('V', 'r1', ENTRY_BASE);             // V stakes -> can be killed for a reward
  b.killByFireball('V', 'A', 'r1', 'k1');          // A earns 175 (70% of the 250 stake spent)
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
  players.forEach(function(p){ b.forfeitStake(p, 'R'); });   // round-end forfeit
  b.payout('A', 'R', players.length);
  eq(b.auditRound('R'), 0, 'entries + kills + forfeits + payout net to exactly zero');
  ok(b.ledger.verifyIntegrity(), 'ledger integrity holds across a full round');
  var neg = false;
  players.forEach(function(p){ if (b.wallet(p).credit < 0 || b.wallet(p).earnings < 0 || b.stakeBalance(p) < 0) neg = true; });
  ok(!neg, 'no player balance is ever negative');
}

/* ---------- flat entry price (no late-comer penalty) ---------- */
section('flat entry price');
{
  eq(entryPrice(0), ENTRY_BASE, 'start = 1000');
  eq(entryPrice(60), ENTRY_BASE, 'a minute in still 1000');
  eq(entryPrice(300), ENTRY_BASE, 'five minutes in still 1000');
  eq(entryPrice(20 * 60), ENTRY_BASE, 'twenty minutes in still 1000');
  eq(entryPrice(60 * 60), ENTRY_BASE, 'an hour in still 1000 (join any time, same price)');
  // a late joiner pays the same 1000 -> the same 4 lives
  var b = new Bank();
  b.grant('L', 5000, 'gL');
  var r = b.enterRound('L', 'rP', entryPrice(1800));
  eq(r.price, ENTRY_BASE, 'charged 1000 even 30 min in');
  eq(b.stakeBalance('L'), ENTRY_BASE, 'held as 1000 stake');
  eq(b.lives('L'), 4, 'always 4 lives');
  invariants(b, 'rP');
}

/* ---------- pot rollover: unclaimed pot -> next round, audits stay zero ---------- */
section('pot rollover');
{
  var b = new Bank();
  b.grant('A', 5000, 'gA'); b.grant('B', 5000, 'gB');
  b.enterRound('A', 'R1', ENTRY_BASE); b.enterRound('B', 'R1', ENTRY_BASE);
  b.forfeitStake('A', 'R1'); b.forfeitStake('B', 'R1');   // round-end forfeit: half of each stake -> pot
  var potR1 = b.potBalance('R1');
  eq(potR1, 1000, 'R1 pot = half of 2 forfeited stakes (no winner, time limit hit)');

  var carried = b.rollover('R1', 'R2');             // R1 expired unclaimed
  eq(carried, 1000, 'entire pot rolls over');
  eq(b.potBalance('R1'), 0, 'R1 pot emptied');
  eq(b.potBalance('R2'), 1000, "R2 starts with R1's pot (no extra house cut)");
  eq(b.houseBalance(), 1000, 'house holds the other half of the forfeited stakes');
  eq(b.auditRound('R1'), 0, 'expired round R1 still audits to zero');
  eq(b.auditRound('R2'), 0, 'rollover legs net to zero within R2');

  // play R2 to a win: pot = rollover + forfeited entries, winner takes it, audit 0
  b.enterRound('A', 'R2', ENTRY_BASE); b.enterRound('B', 'R2', ENTRY_BASE);
  b.forfeitStake('A', 'R2'); b.forfeitStake('B', 'R2');
  eq(b.potBalance('R2'), 1000 + 1000, 'R2 pot = rollover + half the forfeited entries');
  b.payout('A', 'R2', 2);
  eq(b.wallet('A').earnings, BONUS_POT, 'winner takes at least the guaranteed bonus (pot 2000 < 15000)');
  eq(b.potBalance('R2'), 0, 'R2 pot drained');
  eq(b.auditRound('R2'), 0, 'R2 (rollover + entries + payout) nets to zero');
  b.rollover('R1', 'R2');                            // idempotent
  eq(b.potBalance('R2'), 0, 'rollover is idempotent');
  ok(b.ledger.verifyIntegrity(), 'ledger integrity holds through a rollover');
}

/* ---------- abort keeps a carried-over pot (conserved, not stranded) ---------- */
section('abort keeps the carried-over pot');
{
  var b = new Bank();
  b.grant('A', 10000, 'gA');
  b.enterRound('A', 'R1', 1000); b.forfeitStake('A', 'R1');   // R1 ended -> pot(R1) = 500 (half)
  b.rollover('R1', 'R2');                            // pot -> R2 (500)
  b.enterRound('A', 'R2', 1000);                     // A stakes into R2 (pot still 500, rolled)
  eq(b.wallet('A').credit, 8000, 'A paid both entries');
  b.abortRound('R2');                                // void R2: refund the entry, keep the rollover
  eq(b.wallet('A').credit, 9000, 'R2 entry refunded');
  eq(b.stakeBalance('A'), 0, "A's R2 stake reversed on refund");
  eq(b.potBalance('R2'), 500, 'the carried-over pot STAYS (not stranded)');
  eq(b.potBalance('R1'), 0, 'nothing put back into the dead source round');
  b.rollover('R2', 'R3');
  eq(b.potBalance('R3'), 500, 'the carried pot continues forward to the next round');
  ok(b.ledger.verifyIntegrity(), 'ledger integrity holds');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
