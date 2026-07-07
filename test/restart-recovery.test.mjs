// A server restart loses the in-memory round (roundId, entrants, timer), so its
// endRound never fires and stakes would be stranded. The next round's sweep must
// absorb every orphaned stake (50/50 house/pot) and any dead round's leftover pot.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){ return { readyState: 1, send: function(){}, close: function(){} }; }
function total(bank){ var s = 0, r = bank.ledger.rows; for (var i = 0; i < r.length; i++) s += r[i].amount; return s; }

console.log('— the next round sweeps up stakes + pot stranded by a restart');
{
  var bank = new Bank();
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  // A + B were mid-round when the server restarted (that round is now gone)
  bank.enterRound('A', 'DEAD.1', 1000);           // A stake 1000
  bank.enterRound('B', 'DEAD.1', 1000);           // B stake 1000
  bank.killByEater('A', 'DEAD.1', 'k1');          // A stake 750; that round's pot got 125
  eq(bank.stakeBalance('A'), 750, 'A had 750 staked'); eq(bank.stakeBalance('B'), 1000, 'B had 1000 staked');
  eq(bank.potBalance('DEAD.1'), 125, 'the dead round still holds 125 in its pot');

  // restart: fresh Room (new roundId, empty room) -> newRound sweeps orphans
  var room = new Room('room-1', bank); clearInterval(room.timer);
  eq(bank.stakeBalance('A'), 0, "A's orphaned stake swept");
  eq(bank.stakeBalance('B'), 0, "B's orphaned stake swept");
  eq(bank.potBalance('DEAD.1'), 0, 'the dead pot is emptied');
  // A 750 -> 375 house / 375 pot ; B 1000 -> 500 house / 500 pot ; dead pot 125 -> pot
  eq(room.potBalance(), 375 + 500 + 125, 'stranded money lands in the live pot (1000)');
  eq(bank.houseBalance(), 125 + 375 + 500, 'stake halves + the earlier eater share go to the house (1000)');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity holds');
  eq(total(bank), 0, 'total nets to zero');
}

console.log('— a normal round with no orphans: sweep is a no-op');
{
  var bank = new Bank();
  bank.grant('A', 5000, 'gA');
  var room = new Room('t', bank); clearInterval(room.timer);   // fresh bank -> nothing to sweep
  var A = room.addPlayer('A', 'A', mkws());
  eq(bank.stakeBalance('A'), 1000, "active player's stake is untouched");
  eq(room.potBalance(), 0, 'pot still empty (nothing orphaned)');
  ok(bank.ledger.verifyIntegrity(), 'integrity holds');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
