/**
 * Resolve a source rectangle without coupling animation to the scene clock.
 *
 * Combat uses fighter.actionElapsed, reset by the simulation on every action
 * entry (including a cancel into the same action). Preview alone uses
 * previewTime. Existing hit/special aliases and catalog mappings are retained;
 * selecting a frame does not certify the inferred pose as an impact frame.
 */
const ALIASES = Object.freeze({ hit: 'hurt', special: 'punch' });
const LOOPING_ACTIONS = new Set(['idle', 'walk', 'run', 'block']);
const ATTACK_ACTIONS = new Set(['punch', 'kick', 'special']);
const nonnegativeTime = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function resolveAnimationFrame(info, fighter, {
  previewTime = 0,
  reducedMotion = false,
  preview = false,
  duration,
} = {}) {
  const requestedAction = fighter.action || 'idle';
  const mappedAction = ALIASES[requestedAction] || requestedAction;
  const fallback = !info.animations[mappedAction];
  const action = fallback ? 'idle' : mappedAction;
  const animation = info.animations[action];
  if (!animation || !Number.isInteger(animation.frames) || animation.frames < 1) {
    throw new TypeError(`No valid animation for ${info.id || 'fighter'}:${action}`);
  }

  const time = preview
    ? reducedMotion ? 0 : nonnegativeTime(previewTime)
    : nonnegativeTime(fighter.actionElapsed);
  const fps = action === 'idle' ? 7 : 15;
  const looping = LOOPING_ACTIONS.has(action);
  // A known attack clip covers its actual move duration once. Fallback idle
  // deliberately keeps idle's own cadence instead of imitating an attack.
  const scaledAttack = !fallback && ATTACK_ACTIONS.has(requestedAction)
    && Number.isFinite(duration) && duration > 0;
  const rawFrame = Math.floor(scaledAttack
    ? time / duration * animation.frames
    : time * fps);
  const frame = looping
    ? rawFrame % animation.frames
    : Math.min(rawFrame, animation.frames - 1);
  const column = animation.startColumn + frame;
  const row = animation.row;

  return {
    requestedAction,
    action,
    alias: mappedAction === requestedAction ? null : mappedAction,
    fallback,
    animation,
    frame,
    column,
    row,
    sourceX: column * info.frameWidth,
    sourceY: row * info.frameHeight,
    sourceWidth: info.frameWidth,
    sourceHeight: info.frameHeight,
  };
}
