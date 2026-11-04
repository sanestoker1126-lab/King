import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAnimationFrame } from '../src/animation.js';
import { createMatch, getAttackDefinition, getCancelState, stepMatch } from '../src/engine.js';
import { SIMULATION_HZ } from '../src/fighter-profiles.js';

const catalog = JSON.parse(readFileSync(new URL('../public/assets/catalog.json', import.meta.url)));
const byId = id => catalog.fighters.find(fighter => fighter.id === id);

test('every playable fighter starts a new attack at its first mapped cell, independent of scene phase', () => {
  for (const info of catalog.fighters) {
    for (const action of ['punch', 'kick', 'special']) {
      const initial = resolveAnimationFrame(info, { action, actionElapsed: 0 }, { duration: 0.5, previewTime: 123.4 });
      const mapped = info.animations[action === 'special' ? 'punch' : action];
      assert.equal(initial.frame, 0, `${info.id}:${action}`);
      assert.equal(initial.column, mapped.startColumn);
      assert.equal(initial.row, mapped.row);
      assert.equal(initial.sourceX, mapped.startColumn * info.frameWidth);
      assert.equal(initial.sourceY, mapped.row * info.frameHeight);
      assert.equal(initial.sourceWidth, info.frameWidth);
      assert.equal(initial.sourceHeight, info.frameHeight);
    }
  }
});

test('resetting actionElapsed restarts same-action and different-action cancels', () => {
  const info = byId('tobi');
  const fighter = { action: 'punch', actionElapsed: 0.24 };
  assert.ok(resolveAnimationFrame(info, fighter, { duration: 0.34 }).frame > 0);
  fighter.actionElapsed = 0; // Simulation starts a new punch instance.
  assert.equal(resolveAnimationFrame(info, fighter, { duration: 0.34 }).frame, 0);
  fighter.action = 'kick';
  assert.equal(resolveAnimationFrame(info, fighter, { duration: 0.49 }).frame, 0);
});

test('attack clips cover the move duration once and hold their last frame', () => {
  for (const info of catalog.fighters) {
    for (const action of ['punch', 'kick', 'special']) {
      const duration = action === 'punch' ? 0.34 : action === 'kick' ? 0.49 : 0.72;
      const mapped = info.animations[action === 'special' ? 'punch' : action];
      const frameAt = actionElapsed => resolveAnimationFrame(info, { action, actionElapsed }, { duration }).frame;
      assert.equal(frameAt(duration / 2), Math.floor(mapped.frames / 2));
      assert.equal(frameAt(duration - 1e-6), mapped.frames - 1);
      assert.equal(frameAt(duration), mapped.frames - 1);
      assert.equal(frameAt(duration * 10), mapped.frames - 1, `${info.id}:${action} must not wrap`);
    }
  }
});

test('hurt and jump do not repeat their mapped clips after their final frame', () => {
  const info = byId('tobi');
  for (const action of ['hit', 'jump']) {
    const resolved = resolveAnimationFrame(info, { action, actionElapsed: 10 });
    assert.equal(resolved.frame, resolved.animation.frames - 1);
    assert.equal(resolved.fallback, false);
  }
});

test('aliases are explicit and missing states use idle cadence instead of attack cadence', () => {
  const info = byId('mateo');
  const fallback = resolveAnimationFrame(info, { action: 'hit', actionElapsed: 0.2 });
  assert.equal(fallback.requestedAction, 'hit');
  assert.equal(fallback.alias, 'hurt');
  assert.equal(fallback.action, 'idle');
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.frame, 1); // floor(0.2 * 7), not floor(0.2 * 15).
  assert.equal(resolveAnimationFrame(info, { action: 'block', actionElapsed: 0.2 }).frame, 1);
  const special = resolveAnimationFrame(info, { action: 'special', actionElapsed: 0 });
  assert.equal(special.alias, 'punch');
  assert.equal(special.action, 'punch');
  assert.equal(special.fallback, false);
});

test('idle and locomotion loop by their own action clock', () => {
  const info = byId('tobi');
  assert.equal(resolveAnimationFrame(info, { action: 'idle', actionElapsed: 9 / 7 }).frame, 0);
  assert.equal(resolveAnimationFrame(info, { action: 'walk', actionElapsed: 9 / 15 }).frame, 0);
  assert.equal(resolveAnimationFrame(info, { action: 'run', actionElapsed: 10 / 15 }).frame, 1);
});

test('preview time and reduced motion never change combat action timing or add rival phase', () => {
  const info = byId('tobi');
  const fighter = { action: 'punch', actionElapsed: 0.2 };
  const player = resolveAnimationFrame(info, fighter, { duration: 0.34, previewTime: 10 });
  const rival = resolveAnimationFrame(info, fighter, { duration: 0.34, previewTime: 10.2, reducedMotion: true });
  assert.equal(player.frame, rival.frame);
  assert.equal(player.column, rival.column);
  const idle = { action: 'idle', actionElapsed: 0 };
  assert.equal(resolveAnimationFrame(info, idle, { preview: true, previewTime: 0.3 }).frame, 2);
  assert.equal(resolveAnimationFrame(info, idle, { preview: true, previewTime: 0.3, reducedMotion: true }).frame, 0);
});

test('invalid or negative action clocks safely select the first frame', () => {
  for (const actionElapsed of [undefined, NaN, Infinity, -1]) {
    assert.equal(resolveAnimationFrame(byId('tobi'), { action: 'punch', actionElapsed }, { duration: 0.34 }).frame, 0);
  }
});

test('real Tobi punch-to-punch and punch-to-special cancels restart their visual action clock', () => {
  const match = createMatch({ playerId: 'tobi', opponentId: 'mateo', ai: false });
  const attacker = match.fighters.player;
  attacker.x = 400;
  match.fighters.opponent.x = 456;
  const info = byId('tobi');
  const followedSteps = new Set();
  const cancels = [];
  for (let tick = 0; tick < 120 && cancels.length < 2; tick++) {
    const state = getCancelState(attacker);
    const before = resolveAnimationFrame(info, attacker, { duration: getAttackDefinition(attacker)?.duration });
    let input = tick === 0 ? { punch: true } : {};
    if (state.canCancel && !followedSteps.has(state.step)) {
      input = { [state.next]: true };
      followedSteps.add(state.step);
    }
    stepMatch(match, 1 / SIMULATION_HZ, input);
    for (const event of match.events.filter(event => event.type === 'cancel' && event.side === 'player')) {
      cancels.push([event.from, event.to]);
      assert.ok(before.frame > 0, 'The interrupted move must have visually advanced before cancellation');
      assert.equal(attacker.actionElapsed, 0, 'The actual engine must reset even a punch-to-punch cancel');
      const after = resolveAnimationFrame(info, attacker, {
        duration: getAttackDefinition(attacker).duration,
        previewTime: 987.6, // Combat must ignore the scene's unrelated phase.
      });
      assert.equal(after.frame, 0);
      assert.equal(after.column, info.animations.punch.startColumn);
      assert.equal(after.alias, event.to === 'special' ? 'punch' : null);
    }
  }
  assert.deepEqual(cancels, [['punch', 'punch'], ['punch', 'special']]);
});

test('held locomotion and guard advance the real engine action clock instead of resetting each tick', () => {
  const match = createMatch({ playerId: 'tobi', opponentId: 'mateo', ai: false });
  const current = match.fighters.player;
  const info = byId('tobi');
  for (let tick = 0; tick < 10; tick++) stepMatch(match, 1 / SIMULATION_HZ, { right: true });
  assert.equal(current.action, 'walk');
  assert.ok(Math.abs(current.actionElapsed - 9 / SIMULATION_HZ) < 1e-9);
  assert.equal(resolveAnimationFrame(info, current).frame, 2);

  for (let tick = 0; tick < 10; tick++) stepMatch(match, 1 / SIMULATION_HZ, { block: true });
  assert.equal(current.action, 'block');
  assert.ok(Math.abs(current.actionElapsed - 9 / SIMULATION_HZ) < 1e-9);
  const guard = resolveAnimationFrame(info, current);
  assert.equal(guard.fallback, true);
  assert.equal(guard.action, 'idle');
  assert.equal(guard.frame, 1, 'Guard fallback must visibly advance at idle cadence');
});
