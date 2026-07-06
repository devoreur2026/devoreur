// A new Darkness Eater joins the hunt every EATER_ADD_INTERVAL of round time.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { KEEPER_COUNT, EATER_ADD_INTERVAL } from '../shared/config.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }

console.log('— eaters start at KEEPER_COUNT and can be added');
{
  var room = new Room('e', new Bank()); clearInterval(room.timer);
  eq(room.eaters.count, KEEPER_COUNT, 'round starts with KEEPER_COUNT eaters');
  room.eaters.addEater();
  eq(room.eaters.count, KEEPER_COUNT + 1, 'addEater adds exactly one');
  eq(room.eaters.snapshot().length, KEEPER_COUNT + 1, 'snapshot reflects the new eater');
}

console.log('— tick escalates one eater every 5 minutes of round time');
{
  var room = new Room('e2', new Bank()); clearInterval(room.timer);
  function tickAt(t){ room.t = t; room.lastTick = Date.now(); room.tick(); }
  tickAt(0);                              eq(room.eaters.count, KEEPER_COUNT, 't=0: no extra eaters');
  tickAt(EATER_ADD_INTERVAL + 1);         eq(room.eaters.count, KEEPER_COUNT + 1, '+1 after 5 min');
  tickAt(2 * EATER_ADD_INTERVAL + 1);     eq(room.eaters.count, KEEPER_COUNT + 2, '+2 after 10 min');
  tickAt(3 * EATER_ADD_INTERVAL + 1);     eq(room.eaters.count, KEEPER_COUNT + 3, '+3 after 15 min');
  eq(room.eaters.snapshot().length, KEEPER_COUNT + 3, 'client would render all of them');
  // going back in time never removes eaters
  tickAt(10);                             eq(room.eaters.count, KEEPER_COUNT + 3, 'eaters are not removed mid-round');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
