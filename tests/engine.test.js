import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, ATTACKS, createMatch, setPaused, startNextRound, stepMatch } from '../src/engine.js';

const advance = (match, seconds, input = {}) => {
  for (let remaining = seconds; remaining > 1e-8; remaining -= 0.025) stepMatch(match, Math.min(0.025, remaining), input);
  return match;
};
const closeFighters = match => {
  match.fighters.player.x = 400;
  match.fighters.opponent.x = 480;
};

test('a punch connects once with startup, range, damage and knockback', () => {
  const match = createMatch({ ai: false });
  closeFighters(match);
  stepMatch(match, 0.025, { punch: true });
  assert.equal(match.fighters.opponent.health, 100, 'damage waits for startup');
  assert.equal(match.events[0].type, 'punch');
  advance(match, 0.6, { punch: true });
  assert.equal(match.fighters.opponent.health, 100 - ATTACKS.punch.damage);
  assert.equal(match.fighters.opponent.x, 480 + ATTACKS.punch.knockback);
  assert.equal(match.fighters.player.hits, 1);
  advance(match, 1, { punch: true });
  assert.equal(match.fighters.player.hits, 1, 'held punch cannot auto-repeat');
  stepMatch(match, 0.025);
  advance(match, 0.4, { punch: true });
  assert.equal(match.fighters.player.hits, 2, 'release and press attacks again');
});

test('punches miss at distance, while kicks and specials have longer reach', () => {
  for (const [attack, distance, connects] of [['punch', 125, false], ['kick', 125, true], ['special', 245, true], ['special', 290, false]]) {
    const match = createMatch({ ai: false });
    match.fighters.player.x = 300;
    match.fighters.opponent.x = 300 + distance;
    advance(match, 0.85, { [attack]: true });
    assert.equal(match.fighters.opponent.health < 100, connects, `${attack} at ${distance}`);
  }
});

test('blocking reduces damage and preserves guard without registering a clean hit', () => {
  const match = createMatch({ ai: false });
  closeFighters(match);
  advance(match, 0.5, { kick: true, opponent: { block: true } });
  assert.equal(match.fighters.opponent.health, 99);
  assert.equal(match.fighters.opponent.action, 'block');
  assert.equal(match.fighters.player.hits, 0);
  assert.equal(match.fighters.opponent.x, 480 + ATTACKS.kick.knockback * 0.25);
});

test('specials consume energy, respect their cooldown and regenerate energy', () => {
  const match = createMatch({ ai: false });
  stepMatch(match, 0.025, { special: true });
  assert.equal(match.fighters.player.energy, 65);
  assert.equal(match.fighters.player.specialCooldown, 1.3);
  advance(match, 0.75);
  const energy = match.fighters.player.energy;
  stepMatch(match, 0.025, { special: true });
  assert.equal(match.fighters.player.action, 'idle', 'special is still cooling down');
  assert.ok(match.fighters.player.energy > energy);
  advance(match, 0.6);
  stepMatch(match, 0.025, { special: true });
  assert.equal(match.fighters.player.action, 'special');
  match.fighters.player.energy = 0;
  advance(match, 1.4);
  stepMatch(match, 0.025, { special: true });
  assert.notEqual(match.fighters.player.action, 'special', 'insufficient energy prevents a special');
  advance(match, 20);
  assert.equal(match.fighters.player.energy, 100, 'energy stops at its maximum');
});

test('walking and knockback remain inside arena bounds; opposite directions cancel', () => {
  const match = createMatch({ ai: false });
  advance(match, 5, { left: true });
  assert.equal(match.fighters.player.x, ARENA.minX);
  stepMatch(match, 0.025, { left: true, right: true });
  assert.equal(match.fighters.player.x, ARENA.minX);
  advance(match, 5, { opponent: { right: true } });
  assert.equal(match.fighters.opponent.x, ARENA.maxX);
  match.fighters.player.x = ARENA.maxX - 80;
  advance(match, 0.8, { special: true });
  assert.equal(match.fighters.opponent.x, ARENA.maxX);
});

test('a held jump lands once and an airborne fighter can evade a grounded punch', () => {
  const match = createMatch({ ai: false });
  closeFighters(match);
  advance(match, 0.25, { jump: true });
  assert.ok(match.fighters.player.y > 88);
  advance(match, 0.3, { jump: true, opponent: { punch: true } });
  assert.equal(match.fighters.player.health, 100);
  advance(match, 1, { jump: true });
  assert.equal(match.fighters.player.y, 0);
  assert.equal(match.fighters.player.velocityY, 0);
});

test('pause freezes combat and the timer; large or invalid deltas cannot skip simulation', () => {
  const match = createMatch({ ai: false });
  stepMatch(match, 5, { right: true });
  assert.equal(match.timeLeft, 44.95);
  assert.ok(Math.abs(match.fighters.player.x - 296.5) < 1e-9, 'three fixed ticks preserve the 50 ms movement distance');
  setPaused(match);
  const frozen = JSON.stringify(match);
  stepMatch(match, 0.05, { special: true, jump: true });
  assert.equal(JSON.stringify(match), frozen);
  setPaused(match, false);
  const before = match.timeLeft;
  stepMatch(match, NaN, { right: true });
  stepMatch(match, -1, { right: true });
  assert.equal(match.timeLeft, before);
  stepMatch(match, 0.025);
  assert.ok(match.timeLeft < before);
});

test('a knockout awards one round and first to two wins finishes the match', () => {
  const match = createMatch({ ai: false });
  closeFighters(match);
  match.fighters.opponent.health = 9;
  advance(match, 0.3, { punch: true });
  assert.equal(match.status, 'roundOver');
  assert.equal(match.winner, 'player');
  assert.equal(match.fighters.player.wins, 1);
  advance(match, 1, { punch: true });
  assert.equal(match.fighters.player.wins, 1, 'completed round cannot score again');
  startNextRound(match);
  assert.equal(match.round, 2);
  assert.equal(match.fighters.player.wins, 1);
  assert.equal(match.fighters.opponent.health, 100);
  assert.equal(match.timeLeft, 45);
  closeFighters(match);
  match.fighters.opponent.health = 9;
  advance(match, 0.3, { punch: true });
  assert.equal(match.status, 'finished');
  assert.equal(match.fighters.player.wins, 2);
  startNextRound(match);
  assert.equal(match.round, 2, 'finished matches do not advance');
});

test('timeouts compare health; three tied rounds finish as a draw', () => {
  const match = createMatch({ ai: false, duration: 0.1 });
  match.fighters.player.health = 70;
  match.fighters.opponent.health = 50;
  advance(match, 0.2);
  assert.equal(match.timeLeft, 0);
  assert.equal(match.winner, 'player');
  const draw = createMatch({ ai: false, duration: 0.05 });
  for (let round = 1; round <= 3; round += 1) {
    advance(draw, 0.1);
    assert.equal(draw.roundWinner, 'draw');
    if (round < 3) startNextRound(draw);
  }
  assert.equal(draw.status, 'finished');
  assert.equal(draw.winner, 'draw');
  assert.equal(draw.fighters.player.wins, 0);
});

test('AI closes distance and attacks, and an injected random source reproduces combat', () => {
  const first = createMatch({ random: () => 0.5 });
  const second = createMatch({ random: () => 0.5 });
  advance(first, 5);
  advance(second, 5);
  assert.ok(first.fighters.opponent.x < 675, 'AI approaches the player');
  assert.ok(first.fighters.player.health < 100, 'AI deals damage');
  assert.deepEqual(first.fighters, second.fighters);
  assert.equal(first.timeLeft, second.timeLeft);
});

test('simultaneous attacks can trade and produce a double-knockout draw', () => {
  const match = createMatch({ ai: false });
  closeFighters(match);
  match.fighters.player.health = 9;
  match.fighters.opponent.health = 9;
  advance(match, 0.2, { punch: true, opponent: { punch: true } });
  assert.equal(match.fighters.player.health, 0);
  assert.equal(match.fighters.opponent.health, 0);
  assert.equal(match.winner, 'draw');
  assert.equal(match.status, 'roundOver');
});
