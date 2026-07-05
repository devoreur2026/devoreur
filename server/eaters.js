// Server-authoritative Darkness Eater AI, ported from the client enemies.js.
// Extended to hunt many players at once: each eater senses the nearest player
// it can hear or see, chases along that player's BFS field, and kills on
// contact. The server owns all of this; clients only render the results.
import { KEEPER_COUNT, SIGHT_D, HEAR_D, KILL_D, WALK, EATER_PATROL, EATER_CHASE, CARRIER_HEAR_MULT } from '../shared/config.js';
import { makeAgent, agentStep, pickPatrol } from './agents.js';

export class Eaters {
  constructor(maze, dS, best, rnd){
    this.maze = maze;
    this.rnd = rnd;
    this.list = [];
    var placed = [];
    for (var i = 0; i < KEEPER_COUNT; i++){
      var t = null, tries = 0;
      while (tries++ < 60){
        var cand = maze.randOpenCell(dS, best * 0.3, best * 0.95, rnd), ok = true;
        for (var j = 0; j < placed.length; j++){
          if (Math.abs(placed[j].x - cand.x) + Math.abs(placed[j].z - cand.z) < 10){ ok = false; break; }
        }
        if (ok){ t = cand; break; }
      }
      if (!t) t = maze.randOpenCell(dS, best * 0.3, best * 0.95, rnd);
      placed.push(t);
      this.list.push({
        a: makeAgent(maze, t.x, t.z, EATER_PATROL),
        state: 'patrol', lost: 0, senseT: rnd() * 0.15,
        targetId: null, ry: 0
      });
    }
  }

  pickChase(field, a){
    var maze = this.maze;
    var ns = maze.neighbors(a.tx, a.tz), bx = a.tx, bz = a.tz, bv = 1e9;
    for (var i = 0; i < ns.length; i++){
      var v = field ? field[maze.id(ns[i][0], ns[i][1])] : -1;
      if (v >= 0 && v < bv){ bv = v; bx = ns[i][0]; bz = ns[i][1]; }
    }
    if (bv === 1e9){ pickPatrol(maze, this.rnd, a); return; }
    a.ttx = bx; a.ttz = bz;
  }

  // players: [{id,x,z,invuln,speed}]  getField: id -> BFS field  onKill: id => void
  update(dt, t, players, getField, onKill, carrierId){
    var maze = this.maze, rnd = this.rnd, self = this;
    for (var i = 0; i < this.list.length; i++){
      var k = this.list[i], a = k.a;

      // nearest player overall (for kill + facing) and nearest *noticed* (for chase)
      var nearest = null, nearestD = 1e9, noticed = null, noticedD = 1e9;
      for (var p = 0; p < players.length; p++){
        var pl = players[p];
        var dx = pl.x - a.px, dz = pl.z - a.pz, d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearestD){ nearestD = d; nearest = pl; }
        if (pl.invuln > 0) continue;
        var hearR = (pl.speed > WALK) ? 7.5 : HEAR_D;
        if (pl.id === carrierId) hearR *= CARRIER_HEAR_MULT;   // the Torn Map makes you louder
        if (d < hearR || (d < SIGHT_D && maze.los(a.px, a.pz, pl.x, pl.z))){
          if (d < noticedD){ noticedD = d; noticed = pl; }
        }
      }

      k.senseT -= dt;
      if (k.senseT <= 0){
        k.senseT = 0.14;
        if (noticed){
          k.state = 'chase'; k.targetId = noticed.id; k.lost = 0;
        } else if (k.state === 'chase'){
          k.lost += 0.14;
          if (k.lost > 3.2){ k.state = 'patrol'; k.targetId = null; }
        }
      }

      var chasing = k.state === 'chase';
      a.speed = chasing ? EATER_CHASE : EATER_PATROL;
      if (chasing){
        var field = getField(k.targetId);
        agentStep(maze, a, dt, function(ag){ self.pickChase(field, ag); });
      } else {
        agentStep(maze, a, dt, function(ag){
          pickPatrol(maze, rnd, ag);
          if (rnd() < 0.12) ag.idle = 0.4 + rnd() * 0.9;
        });
      }

      // facing (broadcast so clients don't have to guess)
      if (chasing && nearest){ k.ry = Math.atan2(nearest.x - a.px, nearest.z - a.pz); }
      else { k.ry = Math.atan2(a.dirx, a.dirz); }

      // kill: contact with any vulnerable player
      if (nearest && nearestD < KILL_D && nearest.invuln <= 0) onKill(nearest.id);
    }
  }

  snapshot(){
    var out = [];
    for (var i = 0; i < this.list.length; i++){
      var k = this.list[i];
      out.push({ x: +k.a.px.toFixed(3), z: +k.a.pz.toFixed(3), ry: +k.ry.toFixed(3), chase: k.state === 'chase' ? 1 : 0 });
    }
    return out;
  }
}
