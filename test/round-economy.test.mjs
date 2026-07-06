// Integration tests for the room's paid-round economy. Drives the Room class
// directly with an injected fresh Bank (no sockets/auth). Run via npm test.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { ENTRY_FEE, BONUS_POT } from '../shared/economy.js';
import { JOIN_GRACE } from '../shared/config.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){
  var msgs = [];
  return { readyState: 1, send: function(s){ msgs.push(JSON.parse(s)); }, msgs: msgs,
           last: function(t){ for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].t === t) return msgs[i]; return null; } };
}

console.log('— join enters the live round / pot / eater-kill / payout');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var wa = mkws(), wb = mkws();
  var A = room.addPlayer('ALICE', 'A', wa);
  var B = room.addPlayer('BOB', 'B', wb);
  ok(A.paid && B.paid, 'funded players ENTER the round on join (no phantom spectator)');
  eq(room.paidCount, 2, 'paidCount = 2');
  eq(room.potBalance(), 1400, 'pot = 2 * 700');
  eq(bank.houseBalance(), 600, 'house rake = 2 * 300');
  eq(bank.wallet('A').credit, 4000, 'A credit debited 1000 exactly once');
  eq(wa.last('wallet').credit, 4000, 'wallet pushed to client');

  B.invuln = 0;
  room.kill(B.id);                              // eater kill
  eq(bank.wallet('B').credit, 3750, 'eater kill takes 250 from victim');
  eq(room.potBalance(), 1525, 'pot += 125');
  eq(bank.houseBalance(), 725, 'house += 125');
  ok(wb.last('killed') && wb.last('killed').by === 'eater', 'victim told they were caught');

  room.endRound(A);
  eq(bank.wallet('A').earnings, 1525, 'winner earnings = pot (<5 players)');
  var ro = wa.last('roundOver');
  eq(ro.pot, 1525, 'summary pot'); eq(ro.target, 1525, 'summary payout'); eq(ro.topup, 0, 'no top-up');
  eq(bank.auditRound(room.roundId), 0, 'round audit nets to zero');
}

console.log('— can\'t afford = spectate; 5+ bonus top-up');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  var ids = ['A', 'B', 'C', 'D', 'E'];
  ids.forEach(function(a){ bank.grant(a, 5000, 'g' + a); });
  bank.grant('P', 500, 'gP');                    // can't afford entry
  var ws = {}; ids.concat(['P']).forEach(function(a){ ws[a] = mkws(); });
  var P = room.addPlayer('POOR', 'P', ws['P']);  // broke -> spectate
  var players = {};
  ids.forEach(function(a){ players[a] = room.addPlayer(a, a, ws[a]); });

  eq(room.paidCount, 5, 'only the 5 funded players are paid');
  ok(!P.paid, 'broke player is not paid');
  ok(ws['P'].last('spectate').reason === 'insufficient', 'broke player told to spectate');
  eq(room.potBalance(), 3500, 'pot = 5 * 700');

  var houseBefore = bank.houseBalance();
  room.endRound(players['A']);
  eq(bank.wallet('A').earnings, BONUS_POT, 'winner guaranteed 10000 with 5+ players');
  var ro = ws['A'].last('roundOver');
  eq(ro.target, BONUS_POT, 'summary shows 10000'); eq(ro.topup, BONUS_POT - 3500, 'house tops up 6500');
  ok(ro.bonus === true, 'bonus flagged unlocked');
  eq(bank.houseBalance(), houseBefore - ro.topup, 'house paid the top-up');
  eq(bank.auditRound(room.roundId), 0, 'round audit nets to zero');
}

console.log('— late joiner (past grace) spectates until next round');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('L', 5000, 'gL');
  var A = room.addPlayer('A', 'A', mkws());       // enters round
  room.t = JOIN_GRACE + 2;                        // round is now well underway
  var wl = mkws();
  var L = room.addPlayer('LATE', 'L', wl);
  ok(!L.paid, 'funded late joiner spectates (round underway)');
  ok(wl.last('spectate').reason === 'midround', 'told they joined mid-round');
  eq(bank.wallet('L').credit, 5000, 'late joiner not charged this round');
  eq(room.paidCount, 1, 'still just the one paid player');
}

console.log('— refund on abort (last paid player leaves)');
{
  var bank = new Bank();
  var room = new Room('t2', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var A = room.addPlayer('A', 'A', mkws());
  var B = room.addPlayer('B', 'B', mkws());
  var abortedRound = room.roundId;
  eq(bank.wallet('A').credit, 4000, 'A charged entry');
  room.removePlayer(A.id);
  eq(bank.wallet('A').credit, 4000, 'no refund while another paid player remains');
  room.removePlayer(B.id);
  eq(bank.wallet('A').credit, 5000, 'A fully refunded on abort');
  eq(bank.wallet('B').credit, 5000, 'B fully refunded on abort');
  eq(bank.auditRound(abortedRound), 0, 'aborted round nets to zero');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity holds');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
