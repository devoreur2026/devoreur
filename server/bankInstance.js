// The single process-wide Bank. All rooms share it so a player's wallet and
// fireball inventory follow their account across rooms and rounds. A durable
// write-through sink (Supabase) can be attached here later without changing
// any gameplay code.
import { Bank } from './bank.js';

export var bank = new Bank();
