import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, ATTACKS, createMatch, getAttackDefinition, getCancelState, setPaused, startNextRound, stepMatch } from '../src/engine.js';
import { FIGHTER_PROFILES, SIMULATION_HZ } from '../src/fighter-profiles.js';

const DT = 1 / SIMULATION_HZ;
const EPSILON = 1e-8;
const EXPECTED_ROUTES = {
  mateo: ['punch', 'kick', 'special'],
  tobi: ['punch', 'punch', 'special'],
  nadia: ['kick', 'punch', 'special'],
  semillas: ['kick', 'kick', 'punch'],
  oscuro: ['kick', 'special'],
  callejero: ['punch', 'special', 'kick'],
};
const ATTACK_NAMES = Object.keys(ATTACKS);

function setup(id, { side = 'player', mirror = false, corner = false } = {}) {
  const match = createMatch({ playerId: side === 'player' ? id : 'mateo', opponentId: side === 'opponent' ? id : 'mateo', ai: false });
  const defenderSide = side === 'player' ? 'opponent' : 'player';
  const attacker = match.fighters[side];
  const defender = match.fighters[defenderSide];
  attacker.x = corner ? mirror ? ARENA.minX + 80 : ARENA.maxX - 80 : mirror ? 560 : 400;
  defender.x = corner ? mirror ? ARENA.minX : ARENA.maxX : attacker.x + (mirror ? -56 : 56);
  return { match, side, defenderSide, attacker, defender };
}

function tick(state, controls = {}, defenderControls = {}, dt = DT) {
  const input = state.side === 'player'
    ? { ...controls, opponent: defenderControls }
    : { ...defenderControls, opponent: controls };
  stepMatch(state.match, dt, input);
  return structuredClone(state.match.events);
}

const ownEvents = (state, events, type) => events.filter(event => event.side === state.side && (!type || event.type === type));
const ownStarts = (state, events) => ownEvents(state, events).filter(event => ATTACK_NAMES.includes(event.type));

function connectFirst(state, first, { blocked = false } = {}) {
  const events = [];
  for (let frame = 0; frame < 120; frame++) {
    const current = tick(state, frame === 0 ? { [first]: true } : {}, { block: blocked });
    events.push(...current);
    const hit = ownEvents(state, current, 'hit')[0];
    if (hit) {
      assert.equal(hit.blocked, blocked, 'The controlled first hit must have the intended guard outcome');
      return { events, hit };
    }
  }
  assert.fail(`The first ${first} did not connect`);
}

function runRoute(id, options = {}, dt = DT) {
  const state = setup(id, options);
  const route = EXPECTED_ROUTES[id];
  const events = [];
  const triggeredSteps = new Set();
  let firstHit = false;
  let defenderBecameFree = false;
  for (let frame = 0; frame < 240; frame++) {
    const cancel = getCancelState(state.attacker);
    let controls = {};
    if (frame === 0) controls = { [route[0]]: true };
    else if (cancel.confirmed && cancel.open && cancel.next && !triggeredSteps.has(cancel.step)) {
      controls = { [cancel.next]: true };
      triggeredSteps.add(cancel.step);
    }
    const previousRecovery = state.attacker.actionTime;
    const current = tick(state, controls, { block: firstHit }, dt);
    for (const event of ownEvents(state, current, 'cancel')) {
      assert(previousRecovery > 0, `${id}: a cancel must interrupt remaining recovery`);
      assert.equal(event.cost, FIGHTER_PROFILES[id].cancel.cost + ATTACKS[event.to].energy);
      if (dt === DT) {
        assert.equal(state.attacker.actionElapsed, 0, `${id}: every cancel must restart the local action clock`);
        assert.equal(getAttackDefinition(state.attacker).startupTicks, 4, `${id}: the follow-up must use its authored startup`);
      }
    }
    events.push(...current);
    if (ownEvents(state, current, 'hit').length) firstHit = true;
    const hits = ownEvents(state, events, 'hit');
    if (firstHit && hits.length < route.length && state.defender.actionTime <= 0) defenderBecameFree = true;
    if (hits.length === route.length) return { ...state, events, defenderBecameFree };
  }
  assert.fail(`${id}: route did not finish; starts=${ownStarts(state, events).map(event => event.type)}; hits=${ownEvents(state, events, 'hit').length}`);
}

for (const [id, route] of Object.entries(EXPECTED_ROUTES)) {
  test(`${id}: its complete route cancels and connects against first-frame guard, on both sides and at either wall`, () => {
    assert.deepEqual(FIGHTER_PROFILES[id].route, route, 'The authored route must remain character specific');
    for (const side of ['player', 'opponent']) for (const mirror of [false, true]) for (const corner of [false, true]) {
      const result = runRoute(id, { side, mirror, corner });
      const label = `${id}/${side}/${mirror ? 'left' : 'right'}/${corner ? 'wall' : 'center'}`;
      const starts = ownStarts(result, result.events);
      const hits = ownEvents(result, result.events, 'hit');
      const cancels = ownEvents(result, result.events, 'cancel');
      assert.deepEqual(starts.map(event => event.type), route, label);
      assert.equal(cancels.length, route.length - 1, label);
      assert.equal(hits.length, route.length, label);
      assert(hits.every(hit => !hit.blocked), `${label}: a follow-up must hit before held guard can begin`);
      assert.equal(result.defenderBecameFree, false, `${label}: the defender must never regain an actionable frame during the route`);
      assert.equal(result.defender.health, 100 - route.reduce((sum, name) => sum + ATTACKS[name].damage, 0), label);
      assert.equal(result.attacker.facing, mirror ? -1 : 1, label);
    }
  });

  test(`${id}: rejects a different character's follow-up, a whiff and a blocked hit`, () => {
    const wrong = ATTACK_NAMES.find(name => name !== route[1]);
    const illegal = setup(id);
    connectFirst(illegal, route[0]);
    const illegalEvents = [];
    for (let age = 1; age <= 60; age++) illegalEvents.push(...tick(illegal, age === FIGHTER_PROFILES[id].cancel.open + 1 ? { [wrong]: true } : {}, { block: true }));
    assert.equal(ownStarts(illegal, illegalEvents).length, 0, 'A foreign route must not cancel or replay after recovery');

    const guarded = setup(id);
    connectFirst(guarded, route[0], { blocked: true });
    assert.equal(getCancelState(guarded.attacker).confirmed, false, 'Blocked contact cannot confirm a cancel');
    const guardedEvents = [];
    for (let age = 1; age <= 60; age++) guardedEvents.push(...tick(guarded, age === FIGHTER_PROFILES[id].cancel.open + 1 ? { [route[1]]: true } : {}, { block: true }));
    assert.equal(ownStarts(guarded, guardedEvents).length, 0, 'Chip damage must not unlock the chain');

    const missed = setup(id);
    missed.defender.x = missed.attacker.x + 400;
    const missedEvents = [];
    for (let frame = 0; frame < 90; frame++) missedEvents.push(...tick(missed, frame === 0 ? { [route[0]]: true } : frame === 12 ? { [route[1]]: true } : {}));
    assert.equal(ownEvents(missed, missedEvents, 'hit').length, 0);
    assert.deepEqual(ownStarts(missed, missedEvents).map(event => event.type), [route[0]], 'A missed attack cannot cancel or queue a stale follow-up');
  });

  test(`${id}: the cancel window closes instead of accepting a late follow-up`, () => {
    const state = setup(id);
    connectFirst(state, route[0]);
    const events = [];
    for (let age = 1; age <= 60; age++) events.push(...tick(state, age === FIGHTER_PROFILES[id].cancel.close + 1 ? { [route[1]]: true } : {}, { block: true }));
    assert.equal(ownStarts(state, events).length, 0, 'Late inputs may not bypass recovery or remain queued indefinitely');
  });

  test(`${id}: accepts both inclusive cancel-window boundaries`, () => {
    for (const boundary of ['open', 'close']) {
      const state = setup(id, { corner: true });
      const limit = FIGHTER_PROFILES[id].cancel[boundary];
      connectFirst(state, route[0]);
      for (let age = 1; age < limit; age++) tick(state, {}, { block: true });
      const events = tick(state, { [route[1]]: true }, { block: true });
      const cancel = ownEvents(state, events, 'cancel');
      assert.equal(cancel.length, 1, `${id}: the ${boundary} boundary at ${limit} ticks must be usable`);
      assert.equal(cancel[0].to, route[1]);
      const followUp = [];
      for (let frame = 0; frame < 5; frame++) followUp.push(...tick(state, {}, { block: true }));
      assert.equal(ownEvents(state, followUp, 'hit')[0]?.blocked, false, `${id}: even a boundary cancel must connect before guard recovers`);
    }
  });
}

test('six complete routes remain distinct in the actual start events', () => {
  const traces = Object.keys(EXPECTED_ROUTES).map(id => {
    const result = runRoute(id);
    return ownStarts(result, result.events).map(event => event.type).join('>');
  });
  assert.equal(new Set(traces).size, 6);
});

test('a short buffer accepts a released press just before Mateo’s cancel window', () => {
  const state = setup('mateo');
  connectFirst(state, 'punch');
  const early = tick(state, { kick: true }, { block: true });
  assert.equal(ownEvents(state, early, 'cancel').length, 0, 'The follow-up must wait for the window');
  const events = [];
  for (let frame = 0; frame < 8; frame++) events.push(...tick(state, {}, { block: true }));
  assert.deepEqual(ownStarts(state, events).map(event => event.type), ['kick']);
  assert.equal(ownEvents(state, events, 'cancel').length, 1, 'The buffered press must be consumed once');
  assert.equal(ownEvents(state, events, 'hit')[0]?.blocked, false);
});

test('an input buffered too early expires before Oscuro’s confirmed window', () => {
  const state = setup('oscuro');
  const events = [];
  for (let frame = 0; frame < 90; frame++) events.push(...tick(state, frame === 0 ? { kick: true } : frame === 1 ? { special: true } : {}));
  assert.deepEqual(ownStarts(state, events).map(event => event.type), ['kick']);
  assert.equal(ownEvents(state, events, 'cancel').length, 0);
});

test('a buffered press remains usable on its final expiry tick, then expires one tick earlier when entered earlier', () => {
  const lastTick = setup('oscuro', { corner: true });
  connectFirst(lastTick, 'kick');
  const validEvents = tick(lastTick, { special: true }, { block: true });
  for (let age = 2; age <= FIGHTER_PROFILES.oscuro.cancel.open; age++) validEvents.push(...tick(lastTick, {}, { block: true }));
  assert.equal(ownEvents(lastTick, validEvents, 'cancel').length, 1, 'The input must be accepted at the last inclusive expiry tick');

  const expired = setup('oscuro', { corner: true });
  tick(expired, { kick: true });
  while (expired.attacker._attack.elapsedTicks + 1 < getAttackDefinition(expired.attacker).startupTicks) tick(expired);
  const expiredEvents = tick(expired, { special: true });
  assert.equal(ownEvents(expired, expiredEvents, 'hit').length, 1, 'The earlier press must arrive on the actual first-hit step');
  for (let frame = 0; frame < 60; frame++) expiredEvents.push(...tick(expired, {}, { block: true }));
  assert.equal(ownEvents(expired, expiredEvents, 'cancel').length, 0, 'An input one tick older must expire before that window');
  assert.equal(ownStarts(expired, expiredEvents).length, 0);
});

test('held buttons do not generate repeated inputs, including Tobi’s repeated-punch route', () => {
  const held = setup('tobi');
  const heldEvents = [];
  for (let frame = 0; frame < 120; frame++) heldEvents.push(...tick(held, { punch: true }));
  assert.deepEqual(ownStarts(held, heldEvents).map(event => event.type), ['punch']);

  const repeated = setup('tobi');
  connectFirst(repeated, 'punch');
  tick(repeated, {});
  const repeatEvents = [];
  for (let frame = 0; frame < 120; frame++) repeatEvents.push(...tick(repeated, { punch: true }));
  assert.deepEqual(ownStarts(repeated, repeatEvents).map(event => event.type), ['punch'], 'A new press can cancel once, but holding it cannot repeat after recovery');
  assert.equal(ownEvents(repeated, repeatEvents, 'cancel').length, 1);
});

test('the finisher cannot recycle a chain into its starter', () => {
  for (const id of Object.keys(EXPECTED_ROUTES)) {
    const result = runRoute(id);
    const route = EXPECTED_ROUTES[id];
    assert.equal(getCancelState(result.attacker).next, null, `${id}: no follow-up may be offered after the finisher`);
    const events = [];
    for (let age = 1; age <= 8; age++) events.push(...tick(result, age === 2 ? { [route[0]]: true } : {}, { block: true }));
    assert.equal(ownEvents(result, events, 'cancel').length, 0, `${id}: a finisher must close the route`);
    assert.equal(ownStarts(result, events).length, 0, `${id}: the route must not loop while the finisher recovers`);
  }
});

test('cancel meter is charged once, in addition to the follow-up’s base energy', () => {
  for (const id of ['mateo', 'oscuro']) {
    const state = setup(id);
    const profile = FIGHTER_PROFILES[id];
    connectFirst(state, profile.route[0]);
    let before = null;
    let after = null;
    let cancelled = null;
    for (let age = 1; age <= profile.cancel.close; age++) {
      const open = getCancelState(state.attacker).open;
      const controls = open && !cancelled ? { [profile.route[1]]: true } : {};
      const previous = state.attacker.energy;
      const events = tick(state, controls, { block: true });
      const event = ownEvents(state, events, 'cancel')[0];
      if (event) { before = previous; after = state.attacker.energy; cancelled = event; break; }
    }
    assert(cancelled, `${id}: the resource scenario must execute a real cancel`);
    const expected = Math.min(100, before + 9 * DT) - profile.cancel.cost - ATTACKS[profile.route[1]].energy;
    assert(Math.abs(after - expected) < EPSILON, `${id}: incorrect meter cost (${after}, expected ${expected})`);
  }
});

test('insufficient energy rejects a confirmed special cancel without creating an unpaid attack', () => {
  const state = setup('oscuro');
  state.attacker.energy = 0;
  connectFirst(state, 'kick');
  const events = [];
  for (let age = 1; age <= 30; age++) events.push(...tick(state, age === 6 ? { special: true } : {}, { block: true }));
  assert(state.attacker.energy >= 0);
  assert.equal(ownEvents(state, events, 'cancel').length, 0);
  assert.equal(ownStarts(state, events).length, 0);
});

test('a previous special’s cooldown also applies to a later hit-confirmed cancel', () => {
  const state = setup('oscuro', { corner: true });
  connectFirst(state, 'special');
  for (let frames = 0; state.attacker.actionTime > 0 && frames < 120; frames++) tick(state);
  assert(state.attacker.specialCooldown > 0, 'The test must start another attack before the original special cooldown ends');
  connectFirst(state, 'kick');
  const events = [];
  for (let age = 1; age <= 16; age++) events.push(...tick(state, age === 6 ? { special: true } : {}, { block: true }));
  assert.equal(ownEvents(state, events, 'cancel').length, 0);
  assert.equal(ownStarts(state, events).length, 0);
});

test('receiving a real simultaneous hit clears a pending follow-up', () => {
  const state = setup('mateo');
  const events = [];
  for (let frame = 0; frame < 90; frame++) events.push(...tick(state, frame === 0 ? { punch: true } : frame === 2 ? { kick: true } : {}, frame === 0 ? { punch: true } : {}));
  assert(events.some(event => event.type === 'hit' && event.target === state.side), 'The attacker must actually be interrupted');
  assert.deepEqual(ownStarts(state, events).map(event => event.type), ['punch']);
  assert.equal(ownEvents(state, events, 'cancel').length, 0);
});

test('pausing clears a pending follow-up, freezes its clock, and ignores paused input', () => {
  const state = setup('mateo');
  connectFirst(state, 'punch');
  tick(state, { kick: true }, { block: true });
  setPaused(state.match, true);
  const timer = state.match.timeLeft;
  const recovery = state.attacker.actionTime;
  for (let frame = 0; frame < 20; frame++) tick(state, { kick: true }, { block: true }, 0.05);
  assert.equal(state.match.timeLeft, timer);
  assert.equal(state.attacker.actionTime, recovery);
  setPaused(state.match, false);
  const events = [];
  for (let frame = 0; frame < 60; frame++) events.push(...tick(state, {}, { block: true }));
  assert.equal(ownStarts(state, events).length, 0, 'No pre-pause or paused attack may replay after resuming');
});

test('a new round clears both chain progress and pending inputs', () => {
  const state = setup('mateo');
  state.defender.health = ATTACKS.punch.damage;
  for (let frame = 0; state.match.status === 'playing' && frame < 30; frame++) tick(state, frame === 0 ? { punch: true } : frame === 2 ? { kick: true } : {});
  assert.equal(state.match.status, 'roundOver');
  startNextRound(state.match);
  state.attacker = state.match.fighters.player;
  state.defender = state.match.fighters.opponent;
  assert.equal(getCancelState(state.attacker).step, 0);
  const events = [];
  for (let frame = 0; frame < 60; frame++) events.push(...tick(state));
  assert.equal(ownStarts(state, events).length, 0);
});

test('every route remains usable at 30, 60 and 120 external updates per second', () => {
  for (const id of Object.keys(EXPECTED_ROUTES)) for (const hz of [30, 60, 120]) {
    const result = runRoute(id, { corner: true }, 1 / hz);
    assert.deepEqual(ownStarts(result, result.events).map(event => event.type), EXPECTED_ROUTES[id], `${id}/${hz}Hz`);
    assert.equal(result.defenderBecameFree, false, `${id}/${hz}Hz`);
  }
});

test('the CPU confirms each character’s route instead of spending its special cooldown before the starter', () => {
  for (const [id, route] of Object.entries(EXPECTED_ROUTES)) for (const randomValue of [0, 0.5]) {
    const state = setup(id, { side: 'opponent', mirror: true, corner: true });
    state.match.ai = true;
    state.match.random = () => randomValue;
    const events = [];
    let firstHit = false;
    let defenderBecameFree = false;
    for (let frame = 0; frame < 240; frame++) {
      const current = tick(state, {}, { block: firstHit });
      events.push(...current);
      if (ownEvents(state, current, 'hit').length) firstHit = true;
      const hits = ownEvents(state, events, 'hit');
      if (firstHit && hits.length < route.length && state.defender.actionTime <= 0) defenderBecameFree = true;
      if (hits.length >= route.length) break;
    }
    const label = `${id}/random=${randomValue}`;
    assert.deepEqual(ownStarts(state, events).map(event => event.type), route, label);
    assert.equal(ownEvents(state, events, 'cancel').length, route.length - 1, label);
    assert.equal(ownEvents(state, events, 'hit').length, route.length, label);
    assert(ownEvents(state, events, 'hit').every(hit => !hit.blocked), label);
    assert.equal(defenderBecameFree, false, label);
  }
});

test('a press released before the next simulation tick survives the fractional accumulator', () => {
  const state = setup('tobi');
  const events = [];
  events.push(...tick(state, { punch: true }, {}, DT / 2));
  events.push(...tick(state, {}, {}, DT / 2));
  for (let frame = 0; frame < 20; frame++) events.push(...tick(state));
  assert.deepEqual(ownStarts(state, events).map(event => event.type), ['punch']);
  assert.equal(ownEvents(state, events, 'hit').length, 1);
});

test('fixed simulation clocks and action recovery do not depend on how render intervals are partitioned', () => {
  const schedules = [
    Array.from({ length: 30 }, () => 1 / 30),
    Array.from({ length: 60 }, () => 1 / 60),
    Array.from({ length: 120 }, () => 1 / 120),
    Array.from({ length: 10 }, () => [.001, .017, .032, .008, .042]).flat(),
  ];
  const snapshots = schedules.map(schedule => {
    const state = setup('mateo');
    state.defender.x = ARENA.maxX;
    const events = [];
    for (const [index, dt] of schedule.entries()) events.push(...tick(state, { right: true, punch: index === 0 }, {}, dt));
    assert.deepEqual(ownStarts(state, events).map(event => event.type), ['punch']);
    assert.equal(state.match._tick, SIMULATION_HZ);
    return { timeLeft: state.match.timeLeft, x: state.attacker.x, action: state.attacker.action, recovery: state.attacker.actionTime, elapsed: state.attacker.actionElapsed };
  });
  for (const snapshot of snapshots.slice(1)) for (const [key, expected] of Object.entries(snapshots[0])) {
    if (typeof expected === 'number') assert(Math.abs(snapshot[key] - expected) < EPSILON, `${key} changed with render partitioning`);
    else assert.equal(snapshot[key], expected);
  }
});

test('an unconfigured fighter keeps neutral attacks without inheriting a playable route', () => {
  const state = setup('king');
  connectFirst(state, 'punch');
  assert.deepEqual(getCancelState(state.attacker).route, []);
  assert.equal(getCancelState(state.attacker).next, null);
  const events = [];
  for (let age = 1; age <= 60; age++) events.push(...tick(state, age === 3 ? { kick: true } : {}));
  assert.equal(ownStarts(state, events).length, 0);
  assert.equal(ownEvents(state, events, 'cancel').length, 0);
});

test('a genuine release and re-press during pause survives before the next neutral input sample', () => {
  const state = setup('tobi');
  for (let frame = 0; frame < 60; frame++) tick(state, { punch: true });
  assert.equal(state.attacker.action, 'idle');
  setPaused(state.match, true);
  stepMatch(state.match, DT, {}); // The user releases while combat is frozen.
  setPaused(state.match, false);
  const starts = ownStarts(state, tick(state, { punch: true, presses: ['punch'] }));
  assert.deepEqual(starts.map(event => event.type), ['punch']);
  const heldEvents = [];
  for (let frame = 0; frame < 60; frame++) heldEvents.push(...tick(state, { punch: true }));
  assert.equal(ownStarts(state, heldEvents).length, 0, 'a genuine press event must not turn held repeats into new attacks');
});
