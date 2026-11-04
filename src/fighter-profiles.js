/** Authored cancel routes for the playable roster, measured in 60 Hz ticks.
 * These are new gameplay rules, not reconstructed metadata from the sprite packs.
 * A follow-up requires a clean hit; blocked and missed attacks cannot cancel.
 */
export const SIMULATION_HZ = 60;
export const DEFAULT_CANCEL_BUFFER = 5;
export const CANCEL_STARTUP_TICKS = 4;

const profile = (name, route, open, close, style) => Object.freeze({
  name,
  style,
  route: Object.freeze(route),
  cancel: Object.freeze({ open, close, buffer: DEFAULT_CANCEL_BUFFER, cost: 5 }),
});

export const FIGHTER_PROFILES = Object.freeze({
  mateo: profile('Mateo', ['punch', 'kick', 'special'], 3, 7, 'Puño, patada y remate'),
  tobi: profile('Tobi', ['punch', 'punch', 'special'], 1, 5, 'Doble puño de confirmación rápida'),
  nadia: profile('Nadia', ['kick', 'punch', 'special'], 2, 6, 'Patada de apertura y cambio a puño'),
  semillas: profile('Semillas', ['kick', 'kick', 'punch'], 4, 8, 'Doble patada de ritmo pausado'),
  oscuro: profile('Oscuro', ['kick', 'special'], 5, 8, 'Patada y especial de compromiso'),
  callejero: profile('Callejero', ['punch', 'special', 'kick'], 2, 8, 'Puño, especial y patada de cierre'),
});

export function getFighterProfile(id) {
  return Object.hasOwn(FIGHTER_PROFILES, id) ? FIGHTER_PROFILES[id] : null;
}

export const ATTACK_KEYS = Object.freeze({ punch: 'J', kick: 'K', special: 'L' });
export function formatCancelRoute(id) {
  return getFighterProfile(id)?.route.map(action => ATTACK_KEYS[action]).join(' → ') || 'Sin cadena';
}
