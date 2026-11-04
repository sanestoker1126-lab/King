/**
 * Dependency-free combat simulation for a 960 × 420 arena. Inputs arrive at the
 * render rate; combat advances at 60 Hz. dt is seconds, capped at 0.05 per call.
 * fighter.x is its horizontal center, fighter.y is height above the floor.
 * actionTime/actionElapsed/actionDuration are seconds on the local action clock.
 * events aggregate all simulation ticks executed by the most recent call.
 */
import { SIMULATION_HZ, DEFAULT_CANCEL_BUFFER, CANCEL_STARTUP_TICKS, getFighterProfile } from './fighter-profiles.js';

export const ARENA = Object.freeze({ width: 960, height: 420, groundY: 350, minX: 36, maxX: 924 });
export const ATTACKS = Object.freeze({
  punch: Object.freeze({ damage: 9, range: 108, startup: 0.07, active: 0.10, duration: 0.34, knockback: 22, energy: 0 }),
  kick: Object.freeze({ damage: 14, range: 146, startup: 0.13, active: 0.12, duration: 0.49, knockback: 38, energy: 0 }),
  special: Object.freeze({ damage: 24, range: 272, startup: 0.19, active: 0.16, duration: 0.72, knockback: 64, energy: 35 }),
});
const TICK = 1 / SIMULATION_HZ;
const DIFFICULTIES = {
  easy: { reaction: 0.48, aggression: 0.60, block: 0.14, speed: 170 },
  normal: { reaction: 0.29, aggression: 0.82, block: 0.38, speed: 205 },
  hard: { reaction: 0.17, aggression: 0.98, block: 0.64, speed: 230 },
};
const BUTTONS = ['left', 'right', 'jump', 'block', 'punch', 'kick', 'special'];
const ATTACK_PRIORITY = ['special', 'kick', 'punch'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const otherSide = side => side === 'player' ? 'opponent' : 'player';
const ticks = seconds => Math.ceil(seconds * SIMULATION_HZ - 1e-9);
const normalizedInput = input => Object.fromEntries(BUTTONS.map(button => [button, Boolean(input?.[button])]));

function fighter(id, side, wins = 0) {
  return {
    id, x: side === 'player' ? 285 : 675, y: 0, velocityY: 0,
    health: 100, energy: 100, facing: side === 'player' ? 1 : -1,
    action: 'idle', actionTime: 0, actionElapsed: 0, actionDuration: 0,
    hits: 0, wins, specialCooldown: 0, combo: { routeIndex: -1, length: 0 },
    _attack: null, _actionTicks: 0, _cooldownTicks: 0, _tick: 0,
    _previousInput: {}, _heldInput: {}, _pendingJump: false, _buffer: null,
  };
}

/** Create an immediately playable best-of-three match; pass ai:false for local/test controls. */
export function createMatch({ playerId = 'king', opponentId = 'general', difficulty = 'normal', duration = 45, ai = true, random = Math.random } = {}) {
  const roundDuration = Number.isFinite(duration) && duration > 0 ? duration : 45;
  return {
    status: 'playing', round: 1, timeLeft: roundDuration, duration: roundDuration,
    difficulty: Object.hasOwn(DIFFICULTIES, difficulty) ? difficulty : 'normal',
    ai: Boolean(ai), random: typeof random === 'function' ? random : Math.random,
    paused: false, winner: null, roundWinner: null, events: [],
    fighters: { player: fighter(playerId, 'player'), opponent: fighter(opponentId, 'opponent') },
    _ai: { timer: 0.4, intent: {} }, _tick: 0, _roundTicks: 0, _accumulator: 0,
  };
}

function clearPending(current, release = false) {
  current._buffer = null;
  current._pendingJump = false;
  // Retain sampled key state so a held pre-pause button needs an actual release
  // before it can become a new press. Only movement/guard intent is cleared.
  if (release) current._heldInput = {};
}

/** Pausing freezes all clocks and discards unconsumed input, including fractional-frame pulses. */
export function setPaused(match, paused = true) {
  match.paused = Boolean(paused);
  match.events = [];
  for (const current of Object.values(match.fighters)) clearPending(current, true);
  return match;
}

/** Completed non-final rounds preserve wins and reset combat, clocks and pending input. */
export function startNextRound(match) {
  if (match.status !== 'roundOver') return match;
  for (const side of ['player', 'opponent']) {
    const previous = match.fighters[side];
    match.fighters[side] = fighter(previous.id, side, previous.wins);
  }
  match.round += 1;
  match.timeLeft = match.duration;
  match.status = 'playing'; match.winner = null; match.roundWinner = null;
  match.paused = false; match.events = [];
  match._ai = { timer: 0.4, intent: {} };
  match._tick = 0; match._roundTicks = 0; match._accumulator = 0;
  return match;
}

/** Definition on the current action clock, including the accelerated cancel follow-up. */
export function getAttackDefinition(current) {
  return current?._attack?.definition || null;
}

/** Windows are inclusive simulation ticks AFTER a clean hit, never after guard/whiff. */
export function getCancelState(current) {
  const profile = getFighterProfile(current?.id);
  const attack = current?._attack;
  const index = attack?.chainIndex ?? -1;
  const next = profile && index >= 0 ? profile.route[index + 1] || null : null;
  const confirmed = Boolean(attack?.cleanHit && next);
  const sinceHitTicks = confirmed ? current._tick - attack.hitTick : null;
  const open = confirmed && sinceHitTicks >= profile.cancel.open && sinceHitTicks <= profile.cancel.close;
  const cancelCost = profile?.cancel.cost || 0;
  const cost = next ? ATTACKS[next].energy + cancelCost : 0;
  const canCancel = Boolean(open && current.energy >= cost && (next !== 'special' || current.specialCooldown <= 0));
  return {
    route: profile?.route || [], step: index >= 0 ? index + 1 : 0, next,
    confirmed, open: Boolean(open), canCancel, cost, cancelCost,
    sinceHitTicks, remainingTicks: confirmed ? Math.max(0, profile.cancel.close - sinceHitTicks) : 0,
    window: profile ? { open: profile.cancel.open, close: profile.cancel.close } : null,
  };
}

function captureInput(match, current, rawInput) {
  const input = normalizedInput(rawInput);
  // Explicit press events retain release/re-press transitions during pause that
  // cannot be inferred from the sampled held state on the next simulation tick.
  const explicitPresses = new Set(Array.isArray(rawInput?.presses) ? rawInput.presses : []);
  const pressed = name => explicitPresses.has(name) || (input[name] && !current._previousInput[name]);
  // A fresh input during hitstun is not a delayed counterattack after hitstun.
  if (current.action !== 'hit' || current._actionTicks <= 0) {
    if (pressed('jump')) current._pendingJump = true;
    const attack = ATTACK_PRIORITY.find(pressed);
    if (attack) {
      const lifespan = getFighterProfile(current.id)?.cancel.buffer ?? DEFAULT_CANCEL_BUFFER;
      current._buffer = { name: attack, expiresAt: match._tick + lifespan };
    }
  }
  current._previousInput = input;
  current._heldInput = input;
}

function aiInput(match) {
  const computer = match.fighters.opponent;
  const player = match.fighters.player;
  const settings = DIFFICULTIES[match.difficulty];
  const state = match._ai;
  state.timer -= TICK;
  const input = { ...state.intent, punch: false, kick: false, special: false, jump: false };
  const cancel = getCancelState(computer);
  // Hit-confirm decisions use the same short windows as the player, independent
  // of the slower neutral AI reaction timer. One attempt per connecting attack.
  if (cancel.open && cancel.canCancel && !computer._attack.aiCancelAttempted) {
    computer._attack.aiCancelAttempted = true;
    if (match.random() < settings.aggression) { input[cancel.next] = true; input.block = false; }
    return input;
  }
  if (state.timer > 0) return input;
  state.timer = settings.reaction + clamp(match.random(), 0, 1) * 0.12;
  const distance = Math.abs(player.x - computer.x);
  const toward = player.x < computer.x ? 'left' : 'right';
  const profile = getFighterProfile(computer.id);
  const starter = profile?.route[0];
  // Leave room for the two small chain pushbacks before a shorter follow-up.
  // A universal 112-unit stopping distance puts punch starters out of range.
  const desiredRange = profile ? Math.max(48, Math.min(...profile.route.map(name => ATTACKS[name].range)) - 20) : 112;
  input.left = false; input.right = false; input.block = false;
  if (distance > desiredRange) input[toward] = true;
  const playerAttack = getAttackDefinition(player);
  if (playerAttack && distance < playerAttack.range + 35 && match.random() < settings.block) {
    input.block = true; input.left = false; input.right = false;
  } else if (computer.actionTime <= 0 && match.random() < settings.aggression) {
    if (starter && distance <= desiredRange) input[starter] = true;
    else if (distance < 250 && computer.energy >= 35 && computer.specialCooldown <= 0 && match.random() < 0.25) input.special = true;
    else if (!profile && distance < 138) input[match.random() < 0.45 ? 'punch' : 'kick'] = true;
  }
  if (!input.block && distance > 145 && match.random() < 0.08) input.jump = true;
  state.intent = { left: input.left, right: input.right, block: input.block };
  return input;
}

function setAction(current, action, durationTicks = 0, restart = false) {
  if (restart || current.action !== action) current.actionElapsed = 0;
  current.action = action;
  current.actionDuration = durationTicks * TICK;
}

function definitionFor(name, profile, chainIndex, cancelled) {
  const base = ATTACKS[name];
  const originalStartup = ticks(base.startup);
  const activeTicks = ticks(base.active);
  const recoveryTicks = Math.max(1, ticks(base.duration) - originalStartup - activeTicks);
  const startupTicks = cancelled ? CANCEL_STARTUP_TICKS : originalStartup;
  const durationTicks = startupTicks + activeTicks + recoveryTicks;
  const continues = profile && chainIndex >= 0 && chainIndex + 1 < profile.route.length;
  return {
    ...base, startupTicks, activeTicks, recoveryTicks, durationTicks,
    startup: startupTicks * TICK, active: activeTicks * TICK, duration: durationTicks * TICK,
    knockback: continues ? 8 : base.knockback,
  };
}

function startAttack(match, side, name, cancelled = false) {
  const current = match.fighters[side];
  const profile = getFighterProfile(current.id);
  const previous = current._attack;
  const chainIndex = cancelled ? previous.chainIndex + 1 : profile?.route[0] === name ? 0 : -1;
  const definition = definitionFor(name, profile, chainIndex, cancelled);
  const cost = definition.energy + (cancelled ? profile.cancel.cost : 0);
  if (current.energy < cost || (name === 'special' && current._cooldownTicks > 0)) return false;
  current.energy -= cost;
  current._actionTicks = definition.durationTicks;
  current.actionTime = current._actionTicks * TICK;
  setAction(current, name, definition.durationTicks, true);
  current._attack = { name, elapsed: 0, elapsedTicks: 0, connected: false, cleanHit: false,
    direction: current.facing, chainIndex, hitTick: null, definition, aiCancelAttempted: false };
  current.combo = { routeIndex: chainIndex, length: chainIndex >= 0 ? chainIndex + 1 : 0 };
  current._buffer = null;
  if (name === 'special') current._cooldownTicks = ticks(1.3);
  current.specialCooldown = current._cooldownTicks * TICK;
  if (cancelled) match.events.push({ type: 'cancel', side, from: previous.name, to: name, step: chainIndex + 1, cost });
  match.events.push({ type: name, side, cancelled, chainStep: chainIndex >= 0 ? chainIndex + 1 : 0 });
  return true;
}

function updateFighter(match, side) {
  const current = match.fighters[side];
  const target = match.fighters[otherSide(side)];
  const input = current._heldInput;
  current.actionElapsed += TICK;
  current.energy = Math.min(100, current.energy + TICK * 9);
  current._cooldownTicks = Math.max(0, current._cooldownTicks - 1);
  current.specialCooldown = current._cooldownTicks * TICK;
  if (current._actionTicks > 0) current._actionTicks -= 1;
  current.actionTime = current._actionTicks * TICK;
  if (current._attack) {
    if (current._actionTicks === 0) {
      current._attack = null;
      current.combo = { routeIndex: -1, length: 0 };
    } else {
      current._attack.elapsedTicks += 1;
      current._attack.elapsed = current._attack.elapsedTicks * TICK;
    }
  }
  if (current._buffer && current._buffer.expiresAt < match._tick) current._buffer = null;
  if (!current._attack && (current.action !== 'hit' || current._actionTicks === 0)) current.facing = target.x >= current.x ? 1 : -1;

  if (current.y > 0 || current.velocityY > 0) {
    current.velocityY -= 1450 * TICK;
    current.y = Math.max(0, current.y + current.velocityY * TICK);
    if (current.y === 0) current.velocityY = 0;
  }

  if (current._attack && current._buffer) {
    const cancel = getCancelState(current);
    if (cancel.canCancel && current._buffer.name === cancel.next) startAttack(match, side, cancel.next, true);
  }
  if (current._actionTicks <= 0) {
    if (current._pendingJump && current.y === 0) {
      current.velocityY = 590; current.y = 1;
      setAction(current, 'jump', 0, true);
      match.events.push({ type: 'jump', side });
    }
    current._pendingJump = false;
    if (input.block && current.y === 0) {
      setAction(current, 'block');
      current._buffer = null;
    } else {
      const movement = Number(input.right) - Number(input.left);
      if (movement) {
        const speed = side === 'opponent' && match.ai ? DIFFICULTIES[match.difficulty].speed : 230;
        current.x = clamp(current.x + movement * speed * TICK, ARENA.minX, ARENA.maxX);
      }
      // Choose the final neutral action once: an idle intermediary would reset
      // locomotion and guard clips on every tick even while holding the input.
      setAction(current, current.y > 0 ? 'jump' : movement ? 'walk' : 'idle');
      if (current._buffer) startAttack(match, side, current._buffer.name);
    }
  }
  // A jump pressed during a locked action is not saved indefinitely for landing.
  if (current._actionTicks > 0) current._pendingJump = false;
  current.x = clamp(current.x, ARENA.minX, ARENA.maxX);
}

function separateFighters(match) {
  const { player, opponent } = match.fighters;
  if (Math.abs(player.y - opponent.y) >= 85) return;
  const distance = Math.abs(player.x - opponent.x);
  if (distance >= 48) return;
  const direction = opponent.x >= player.x ? 1 : -1;
  const correction = (48 - distance) / 2;
  player.x = clamp(player.x - direction * correction, ARENA.minX, ARENA.maxX);
  opponent.x = clamp(opponent.x + direction * correction, ARENA.minX, ARENA.maxX);
}

function collectHit(match, side) {
  const attacker = match.fighters[side];
  const defender = match.fighters[otherSide(side)];
  const attack = attacker._attack;
  if (!attack || attack.connected) return null;
  const definition = attack.definition;
  if (attack.elapsedTicks < definition.startupTicks || attack.elapsedTicks >= definition.startupTicks + definition.activeTicks) return null;
  const distance = (defender.x - attacker.x) * attack.direction;
  if (distance < 0 || distance > definition.range || Math.abs(defender.y - attacker.y) > 88) return null;
  attack.connected = true;
  return { side, attacker, defender, attack, definition,
    blocked: defender.action === 'block' && defender.facing === -attack.direction };
}

function applyHit(match, hit) {
  const { side, attacker, defender, attack, definition, blocked } = hit;
  const damage = blocked ? (attack.name === 'special' ? 5 : 1) : definition.damage;
  defender.health = Math.max(0, defender.health - damage);
  const knockback = blocked ? ATTACKS[attack.name].knockback * 0.25 : definition.knockback;
  defender.x = clamp(defender.x + attack.direction * knockback, ARENA.minX, ARENA.maxX);
  if (!blocked) {
    attacker.hits += 1;
    attacker.energy = Math.min(100, attacker.energy + 3);
    attack.cleanHit = true;
    attack.hitTick = match._tick;
    defender._actionTicks = ticks(attack.name === 'special' ? 0.32 : 0.21);
    defender.actionTime = defender._actionTicks * TICK;
    setAction(defender, 'hit', defender._actionTicks, true);
    defender._attack = null;
    defender.combo = { routeIndex: -1, length: 0 };
    clearPending(defender);
  }
  match.events.push({ type: 'hit', side, target: otherSide(side), attack: attack.name,
    damage, blocked, x: defender.x, y: defender.y, chainStep: attack.chainIndex >= 0 ? attack.chainIndex + 1 : 0 });
}

function finishRound(match) {
  const { player, opponent } = match.fighters;
  const winner = player.health === opponent.health ? 'draw' : player.health > opponent.health ? 'player' : 'opponent';
  match.roundWinner = winner; match.winner = winner;
  if (winner !== 'draw') match.fighters[winner].wins += 1;
  match.events.push({ type: 'roundOver', winner, round: match.round });
  if (player.wins >= 2 || opponent.wins >= 2 || match.round >= 3) {
    match.status = 'finished';
    match.winner = player.wins === opponent.wins ? 'draw' : player.wins > opponent.wins ? 'player' : 'opponent';
    match.events.push({ type: 'finished', winner: match.winner });
  } else match.status = 'roundOver';
  for (const current of Object.values(match.fighters)) clearPending(current, true);
}

/**
 * Capture render-rate input edges, then run complete fixed ticks. Fractional
 * calls retain pulses until a tick executes; held attacks never auto-repeat.
 * Optional input.opponent supplies test/local controls when ai:false.
 * Optional input.presses lists genuine new button presses, not held repeats.
 */
export function stepMatch(match, dt, input = {}) {
  match.events = [];
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
  if (match.paused || match.status !== 'playing' || step === 0) return match;
  captureInput(match, match.fighters.player, input);
  if (!match.ai) captureInput(match, match.fighters.opponent, input.opponent);
  match._accumulator += step;
  while (match._accumulator + 1e-10 >= TICK && match.status === 'playing') {
    match._accumulator = Math.max(0, match._accumulator - TICK);
    match._tick += 1;
    for (const current of Object.values(match.fighters)) current._tick = match._tick;
    if (match.ai) captureInput(match, match.fighters.opponent, aiInput(match));
    updateFighter(match, 'player'); updateFighter(match, 'opponent');
    separateFighters(match);
    // Collect before applying: simultaneous connecting attacks trade fairly.
    const hits = ['player', 'opponent'].map(side => collectHit(match, side)).filter(Boolean);
    for (const hit of hits) applyHit(match, hit);
    match._roundTicks += 1;
    match.timeLeft = Math.max(0, match.duration - match._roundTicks * TICK);
    if (match.fighters.player.health <= 0 || match.fighters.opponent.health <= 0 || match.timeLeft <= 1e-8) {
      if (match.timeLeft <= 1e-8) match.timeLeft = 0;
      finishRound(match);
    }
  }
  return match;
}
