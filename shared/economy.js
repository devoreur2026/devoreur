// The economy: every price, percentage and split rule lives here and is
// enforced server-side. Money is whole CDF Coins (integers) — splits are done
// so the parts ALWAYS sum exactly to the whole (the remainder gets the last
// bucket), so rounding can never create or destroy a coin.
export var COIN = 'CDF';

// wallet buckets
export var CREDIT = 'credit';       // spendable
export var EARNINGS = 'earnings';   // winnings
export var HOLD = 'hold';           // earnings held while a withdrawal is in flight

// system accounts
export var HOUSE = 'house';
export var MINT = 'mint';           // external money source/sink (grants)
export var GATEWAY = 'gateway';     // real-money in/out via the payment gateway (may go negative)
export function POT(roundId){ return 'pot:' + roundId; }

// round economy — OPEN MAZE with a rising entry price
export var ENTRY_BASE = 1000;       // CDF base entry
export var ENTRY_PER_MINUTE = 50;   // + this per full minute since the round started
export var ENTRY_MAX = 2000;        // the entry price stops growing here (reached at minute 20)
export var HOUSE_RAKE = 0.30;       // 30% of each entry -> house, rest -> pot
export var ROUND_LIMIT = 1200;      // seconds (20 min); Heart unclaimed at the limit -> pot rolls over
export var ENTRY_CLOSE = 960;       // seconds; entries lock 4 min before the limit
export var KILL_PENALTY = 250;      // victim loses up to this from Credit (never negative)
export var FIREBALL_KILLER_SHARE = 0.70;  // of the taken amount -> killer EARNINGS, rest -> pot
export var EATER_HOUSE_SHARE = 0.50;      // of the taken amount -> house, rest -> pot
export var BONUS_MIN_PLAYERS = 5;   // 5+ paid players unlocks the guaranteed bonus
export var BONUS_POT = 10000;       // winner gets max(pot, BONUS_POT); house tops up the gap

// shop / fireballs
export var FIREBALL_PACK = 10;      // sold in packs of 10
export var FIREBALL_PACK_PRICE = 100;   // 100 CDF per pack (10 CDF each)

// fireball combat (server-simulated)
export var FIREBALL_SPEED = 26;         // units/sec
export var FIREBALL_RANGE = 42;         // max travel
export var FIREBALL_COOLDOWN = 0.8;     // seconds between throws
export var FIREBALL_HIT_R = 0.85;       // hit radius vs a player
export var FIREBALL_FLARE = 1.4;        // seconds a thrower is "loud" to eaters

// dev-only test grant amount
export var DEV_GRANT = 5000;

/* ---- pure split helpers: parts always sum to the whole ---- */
// Entry price rises 50 CDF per full minute since the round started, capped at
// ENTRY_MAX. 0:00–0:59 -> 1000, 1:00 -> 1050, 5:00 -> 1250, 20:00+ -> 2000.
export function entryPrice(roundElapsedSeconds){
  var minutes = Math.floor(Math.max(0, roundElapsedSeconds) / 60);
  return Math.min(ENTRY_MAX, ENTRY_BASE + ENTRY_PER_MINUTE * minutes);
}
export function entriesOpen(roundElapsedSeconds){ return roundElapsedSeconds < ENTRY_CLOSE; }
export function splitEntry(price){
  var house = Math.round(price * HOUSE_RAKE);
  return { house: house, pot: price - house };
}
// amount actually taken from a victim's Credit (never more than they have)
export function killTaken(victimCredit){
  return Math.max(0, Math.min(KILL_PENALTY, victimCredit | 0));
}
export function splitFireballKill(taken){
  var killer = Math.round(taken * FIREBALL_KILLER_SHARE);
  return { killer: killer, pot: taken - killer };
}
export function splitEaterKill(taken){
  var house = Math.round(taken * EATER_HOUSE_SHARE);
  return { house: house, pot: taken - house };
}
// what the winner receives from a round with `paidPlayers` paid entries
export function winnerPayout(pot, paidPlayers){
  return paidPlayers >= BONUS_MIN_PLAYERS ? Math.max(pot, BONUS_POT) : pot;
}
export function bonusUnlocked(paidPlayers){ return paidPlayers >= BONUS_MIN_PLAYERS; }
