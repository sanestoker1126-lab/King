#!/usr/bin/env node
/** Current combat audit. Report completion is separate from requirement approval.
 * Run: node scripts/audit-combat.mjs [--output path.json] [--strict]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../src/engine.js';
import { FIGHTER_PROFILES, SIMULATION_HZ } from '../src/fighter-profiles.js';

const { ARENA, ATTACKS, createMatch, stepMatch, getCancelState } = engine;
const root = fileURLToPath(new URL('../', import.meta.url));
let output = path.join(root, 'audit-output/combat.json');
let strict = false;
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === '--strict') strict = true;
  else if (arg === '--output') {
    const value = process.argv[++index];
    if (!value || value.startsWith('--')) throw new Error('--output requires a file path');
    output = path.resolve(value);
  } else if (arg === '--help' || arg === '-h') {
    console.log('node scripts/audit-combat.mjs [--output path.json] [--strict]');
    process.exit(0);
  } else throw new Error(`Unknown argument: ${arg}`);
}
assert.equal(typeof getCancelState, 'function', 'This audit requires the current cancel-state API');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'public/assets/catalog.json'), 'utf8'));
const sourceNames = ['src/engine.js', 'src/fighter-profiles.js', 'src/animation.js', 'src/main.js', 'public/assets/catalog.json'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')])));
let gitHead = null;
try { gitHead = execFileSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { /* File hashes remain available without Git. */ }
const ids = catalog.fighters.map(fighter => fighter.id);
assert(ids.length > 0 && new Set(ids).size === ids.length);
for (const id of ids) assert(FIGHTER_PROFILES[id], `Missing current profile for ${id}`);
const attacks = Object.keys(ATTACKS);
const dt = 1 / SIMULATION_HZ;
const rounded = value => Math.round(value * 1e6) / 1e6;
const playerEvents = match => match.events.filter(event => event.side === 'player');

function fresh(id, { spacing = 80, mirrored = false, corner = true } = {}) {
  const match = createMatch({ playerId: id, opponentId: ids.find(other => other !== id) || id, ai: false });
  match.fighters.player.x = corner ? mirrored ? ARENA.minX + spacing : ARENA.maxX - spacing : mirrored ? 560 : 400;
  match.fighters.opponent.x = corner ? mirrored ? ARENA.minX : ARENA.maxX : mirrored ? 560 - spacing : 400 + spacing;
  return match;
}

/** Same candidate inputs are tested against every fighter, including foreign routes.
 * The defender keeps guard from the call after the first clean hit. Each candidate
 * follow-up is pressed once at the audited fighter's declared cancel opening.
 */
function routeProbe(id, candidate, { mode = 'clean', mirrored = false, corner = true } = {}) {
  const profile = FIGHTER_PROFILES[id];
  const match = fresh(id, { spacing: mode === 'whiff' ? 500 : 80, mirrored, corner });
  let lastHitFrame = null;
  let firstHitFrame = null;
  let defenderFirstFreeFrame = null;
  let attemptedStage = 0;
  const starts = [];
  const hits = [];
  const cancels = [];
  const attempts = [];
  let stage = 0;
  for (let frame = 0; frame < 240; frame++) {
    let input = frame === 0 ? { [candidate[0]]: true } : {};
    const previous = match.fighters.player;
    const attemptFrame = lastHitFrame === null ? Math.ceil(ATTACKS[candidate[0]].startup * SIMULATION_HZ) + profile.cancel.open + 2 : lastHitFrame + profile.cancel.open;
    if (frame > 0 && (stage === 0 || lastHitFrame !== null) && attemptedStage === stage && stage < candidate.length - 1 && frame >= attemptFrame) {
      const next = candidate[stage + 1];
      input = { [next]: true };
      attempts.push({ frame, next, recoveryBeforeSeconds: rounded(previous.actionTime), stateBefore: structuredClone(getCancelState(previous)) });
      attemptedStage++;
    }
    input.opponent = { block: mode === 'blocked' || firstHitFrame !== null };
    stepMatch(match, dt, input);
    const events = playerEvents(match);
    const cancelled = events.find(event => event.type === 'cancel');
    if (cancelled) {
      cancels.push({ frame, ...cancelled, resultingAction: match.fighters.player.action });
      stage++;
      lastHitFrame = null;
    }
    for (const event of events) {
      if (attacks.includes(event.type)) starts.push({ frame, ...event });
      if (event.type === 'hit') {
        hits.push({ frame, ...event });
        lastHitFrame = frame;
        firstHitFrame ??= frame;
      }
    }
    if (firstHitFrame !== null && match.fighters.opponent.action === 'block' && match.fighters.opponent.actionTime === 0) defenderFirstFreeFrame ??= frame;
    if (hits.length === candidate.length || (attempts.length > 0 && frame > attempts.at(-1).frame + profile.cancel.buffer + 3 && cancels.length < attempts.length)) break;
  }
  const expectedCancels = candidate.length - 1;
  const completed = cancels.length === expectedCancels && starts.length === candidate.length && hits.length === candidate.length && hits.every(hit => !hit.blocked);
  const trueCombo = completed && (defenderFirstFreeFrame === null || defenderFirstFreeFrame > hits.at(-1).frame);
  return { id, candidate: [...candidate], mode, mirrored, corner, completed, trueCombo,
    expectedCancels, starts, hits, cancels, attempts, defenderFirstFreeFrame,
    cancelledBeforeRecovery: cancels.length > 0 && attempts.slice(0, cancels.length).every(attempt => attempt.recoveryBeforeSeconds > 0) };
}

function measureAttack(id, attack, hz, blocking = false) {
  const match = fresh(id);
  const events = [];
  let firstHit = null;
  let firstStart = null;
  let readySeconds = null;
  let guardSeconds = null;
  let previous = match.fighters.player.actionTime;
  for (let call = 0; call < hz * 2; call++) {
    const input = call === 0 ? { [attack]: true } : {};
    input.opponent = { block: blocking || firstHit !== null };
    stepMatch(match, 1 / hz, input);
    for (const event of playerEvents(match)) {
      const observation = { call, observedAfterSeconds: rounded((call + 1) / hz), ...event };
      events.push(observation);
      if (event.type === attack) firstStart ??= observation;
      if (event.type === 'hit') firstHit ??= { ...observation, defenderRecoverySeconds: match.fighters.opponent.actionTime };
    }
    if (firstStart && previous > 0 && match.fighters.player.actionTime === 0) readySeconds ??= rounded((call + 1) / hz);
    if (firstHit && match.fighters.opponent.action === 'block' && match.fighters.opponent.actionTime === 0) guardSeconds ??= rounded((call + 1) / hz);
    previous = match.fighters.player.actionTime;
  }
  assert(firstStart && firstHit && readySeconds !== null, `Attack probe did not execute ${id}/${attack}/${hz}`);
  assert.equal(firstHit.blocked, blocking);
  return { id, attack, hz, firstStart, firstHit, readyObservedAfterSeconds: readySeconds, guardObservedAfterSeconds: guardSeconds, events,
    limitation: 'Outer-call observations are quantized to the caller frequency; internal-tick event data, where supplied by the engine, is authoritative.' };
}

const declaredProfiles = ids.map(id => ({ id, ...FIGHTER_PROFILES[id] }));
const routeMatrix = ids.flatMap(id => ids.map(candidateOwner => ({ candidateOwner, ...routeProbe(id, FIGHTER_PROFILES[candidateOwner].route) })));
const intendedRoutes = routeMatrix.filter(result => result.id === result.candidateOwner);
const foreignRoutes = routeMatrix.filter(result => result.id !== result.candidateOwner);
const mirroredRoutes = ids.map(id => routeProbe(id, FIGHTER_PROFILES[id].route, { mirrored: true }));
const centerRoutes = ids.map(id => routeProbe(id, FIGHTER_PROFILES[id].route, { corner: false }));
const blockedRoutes = ids.map(id => routeProbe(id, FIGHTER_PROFILES[id].route, { mode: 'blocked' }));
const missedRoutes = ids.map(id => routeProbe(id, FIGHTER_PROFILES[id].route, { mode: 'whiff' }));
const fingerprints = ids.map(id => {
  // Behavioral signature uses the acceptance/rejection of identical candidate
  // routes, not merely different input sequences selected by the fighter ID.
  const behavior = routeMatrix.filter(result => result.id === id).map(result => ({ candidateOwner: result.candidateOwner, completed: result.completed, trueCombo: result.trueCombo, actualAttacks: result.starts.map(event => event.type), cancelCount: result.cancels.length }));
  return { id, signature: createHash('sha256').update(JSON.stringify(behavior)).digest('hex'), behavior };
});
const groups = Map.groupBy(fingerprints, result => result.signature);
const duplicateGroups = [...groups.entries()].filter(([, values]) => values.length > 1).map(([signature, values]) => ({ signature, ids: values.map(value => value.id) }));
const frameData = ids.flatMap(id => attacks.flatMap(attack => [30, 60, 120].map(hz => measureAttack(id, attack, hz))));
const guardData = ids.flatMap(id => attacks.map(attack => measureAttack(id, attack, 60, true)));
const requiredAnimations = ['idle', 'walk', 'jump', 'block', 'punch', 'kick', 'special', 'hurt'];
const mappingCoverage = catalog.fighters.map(fighter => ({ id: fighter.id, available: Object.keys(fighter.animations), missing: requiredAnimations.filter(action => !fighter.animations[action]),
  note: 'Declared catalog coverage only. Inferred pose semantics, source aliases and anatomical pivots remain separate visual-audit work.' }));
const clockMatch = fresh(ids[0]);
for (let call = 0; call < 10; call++) stepMatch(clockMatch, 0.1);
const advancedSeconds = rounded(clockMatch.duration - clockMatch.timeLeft);
const routePassed = result => result.completed && result.trueCombo && result.cancelledBeforeRecovery;
const requirements = {
  uniqueMechanicalSignatures: { status: groups.size === ids.length && intendedRoutes.every(routePassed) && foreignRoutes.every(result => !result.completed) ? 'PASS' : 'FAIL',
    evidence: { fighterCount: ids.length, uniqueSignatures: groups.size, duplicateGroups, intendedRoutesPassed: intendedRoutes.filter(routePassed).length, foreignRoutesRejected: foreignRoutes.filter(result => !result.completed).length, foreignRoutesTested: foreignRoutes.length },
    limitation: 'Distinguishes the authored cancel routes in the tested scenarios; base attacks can still share statistics and this does not prove balance or originality of every move.' },
  hitConfirmedRecoveryCancels: { status: [...intendedRoutes, ...mirroredRoutes, ...centerRoutes].every(routePassed) && [...blockedRoutes, ...missedRoutes].every(result => result.cancels.length === 0) ? 'PASS' : 'FAIL',
    evidence: { cleanRoutesTested: intendedRoutes.length + mirroredRoutes.length + centerRoutes.length, cleanRoutesPassed: [...intendedRoutes, ...mirroredRoutes, ...centerRoutes].filter(routePassed).length, blockedRoutesRejected: blockedRoutes.filter(result => result.cancels.length === 0).length, missedRoutesRejected: missedRoutes.filter(result => result.cancels.length === 0).length },
    limitation: 'Verifies finite authored routes and clean-hit conditions. Exhaustive boundary/resource/interruption cases belong to the regression tests.' },
  declaredAnimationCoverage: { status: mappingCoverage.some(result => result.missing.length) ? 'FAIL' : 'PASS', evidence: mappingCoverage },
};
const findings = [];
if (requirements.uniqueMechanicalSignatures.status === 'FAIL') findings.push({ id: 'cancel-route-uniqueness', severity: 'high', status: 'FAIL', proof: requirements.uniqueMechanicalSignatures.evidence });
if (requirements.hitConfirmedRecoveryCancels.status === 'FAIL') findings.push({ id: 'cancel-route-behavior', severity: 'high', status: 'FAIL', proof: requirements.hitConfirmedRecoveryCancels.evidence });
if (requirements.declaredAnimationCoverage.status === 'FAIL') findings.push({ id: 'missing-action-mappings', severity: 'high', status: 'FAIL', message: 'One or more gameplay actions lack authored catalog clips. Passing cancel mechanics does not certify the sprites or pivots.', proof: mappingCoverage });
if (guardData.every(result => result.firstHit.defenderRecoverySeconds === 0)) findings.push({ id: 'no-blockstun', severity: 'medium', status: 'OBSERVED', message: 'Blocked attacks assign no recovery lock to the defender. Cancel rules reject blocked hits.' });
if (advancedSeconds < 1) findings.push({ id: 'discarded-wall-time', severity: 'medium', status: 'OBSERVED', message: 'The retained outer-call 50ms cap drops excess wall time.', proof: { requestedSeconds: 1, advancedSeconds } });
const report = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), provenance: { gitHead, sha256: sourceHashes }, scope: 'Current authored six-fighter cancel implementation. Historical pre-change findings remain in the narrative report; this file measures the current source hashes.',
  methodology: { simulationHz: SIMULATION_HZ, inputs: 'Actual attack/guard inputs; only initial positions are arranged. Guard is held after first clean hit, and follow-ups are pressed once at the profile opening.', mechanicalComparison: 'The same six candidate routes are tested against every fighter, then acceptance/rejection patterns are fingerprinted.', timing: 'Event observations occur at outer-call boundaries; an outer call can contain multiple fixed ticks or no tick.',
    samples: { routeMatrix: routeMatrix.length, intendedRoutes: intendedRoutes.length, foreignRoutes: foreignRoutes.length, mirroredRoutes: mirroredRoutes.length, centerRoutes: centerRoutes.length, blockedRoutes: blockedRoutes.length, missedRoutes: missedRoutes.length, cleanAttackTimings: frameData.length, blockedAttackTimings: guardData.length },
    authoredRules: 'Cancel routes are new authored gameplay rules, not recovered original move data. Catalog pose mappings remain inferred.' },
  result: Object.values(requirements).some(result => result.status === 'FAIL') ? 'FAIL' : 'PASS', requirements, findings,
  declaredProfiles, fingerprints, routeMatrix, intendedRoutes, foreignRoutes, mirroredRoutes, centerRoutes, blockedRoutes, missedRoutes, frameData, guardData, mappingCoverage,
  highDeltaProbe: { requestedSeconds: 1, advancedSeconds },
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Combat audit completed: ${report.result}. ${ids.length} fighters; ${groups.size} distinct cancel-behavior signature(s).`);
for (const [name, requirement] of Object.entries(requirements)) console.log(`${requirement.status} ${name}`);
console.log(`Clean intended routes: ${intendedRoutes.filter(routePassed).length}/${ids.length}; foreign routes rejected: ${foreignRoutes.filter(result => !result.completed).length}/${foreignRoutes.length}.`);
console.log(`Evidence saved to ${output}`);
console.log(strict ? 'Strict mode: failed requirements cause exit 1.' : 'Report mode exit 0 means analysis completed, not that every requirement passed.');
if (strict && report.result === 'FAIL') process.exitCode = 1;
