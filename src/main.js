import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-700.css';
import './style.css';
import { createMatch, stepMatch, startNextRound, setPaused, getCancelState, getAttackDefinition, ATTACKS, ARENA } from './engine.js';
import { getFighterProfile, formatCancelRoute, ATTACK_KEYS } from './fighter-profiles.js';
import { resolveAnimationFrame } from './animation.js';

const $ = id => document.getElementById(id);
const canvas = $('game-canvas');
const context = canvas.getContext('2d');
const assetUrl = path => `${import.meta.env.BASE_URL}${path}`;
const textures = new Map();
const keyboard = new Set();
const touch = new Map();
const queuedPresses = new Set();
const edgeControls = new Set(['jump', 'punch', 'kick', 'special']);
const keyMap = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyW: 'jump', ArrowUp: 'jump', KeyS: 'block', ArrowDown: 'block', KeyJ: 'punch', KeyK: 'kick', KeyL: 'special' };
const colorways = ['#665a36', '#516442', '#4e5367', '#794e35', '#5b4259', '#485c5c'];
let catalog;
let selectedFighter = 'tobi';
let selectedStage = 'patio';
let match = null;
let soundOn = false;
let lastFrame = performance.now();
let elapsed = 0;
let particles = [];
let wins = 0;
let displayedStatus = '';
const audioPool = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
try { wins = Math.max(0, Number.parseInt(localStorage.getItem('puente-grande-wins'), 10) || 0); } catch { /* Browser storage is optional. */ }
$('wins-count').textContent = String(wins).padStart(2, '0');

function announce(text) { $('announcement').textContent = text; }
function fighterById(id) { return catalog.fighters.find(fighter => fighter.id === id); }
function stageById(id) { return catalog.backgrounds.find(stage => stage.id === id); }
function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { textures.set(path, image); resolve(image); };
    image.onerror = () => reject(new Error(`No se pudo cargar ${path}`));
    image.src = assetUrl(path);
  });
}

function buildSelection() {
  const ordered = [...catalog.fighters].sort((a, b) => (a.id === 'tobi' ? -1 : b.id === 'tobi' ? 1 : 0));
  for (const [index, fighter] of ordered.entries()) {
    const button = document.createElement('button');
    button.className = 'fighter-card';
    button.dataset.fighter = fighter.id;
    button.setAttribute('aria-label', `Elegir a ${fighter.name}`);
    button.setAttribute('aria-pressed', String(fighter.id === selectedFighter));
    button.style.setProperty('--fighter-color', colorways[index]);
    // Names and paths come from the validated local catalog, never injected markup.
    const portrait = document.createElement('div'); portrait.className = 'fighter-portrait';
    const number = document.createElement('span'); number.className = 'fighter-index'; number.textContent = `${String(index + 1).padStart(2, '0')} / PG`;
    const badge = document.createElement('span'); badge.className = 'fighter-badge'; badge.textContent = '✓'; badge.hidden = fighter.id !== selectedFighter;
    const imageCanvas = document.createElement('canvas'); imageCanvas.width = 240; imageCanvas.height = 180; imageCanvas.setAttribute('aria-hidden', 'true');
    portrait.append(number, imageCanvas, badge);
    const description = document.createElement('div'); description.className = 'fighter-description';
    const name = document.createElement('span'); name.className = 'fighter-name'; name.textContent = fighter.name.toUpperCase();
    const hint = document.createElement('span'); hint.textContent = fighter.id === selectedFighter ? 'ELEGIDO' : '+';
    description.append(name, hint);
    const route = document.createElement('span'); route.className = 'fighter-route';
    route.id = `route-${fighter.id}`; route.textContent = formatCancelRoute(fighter.id);
    button.setAttribute('aria-describedby', route.id);
    button.append(portrait, description, route);
    const bounds = fighter.portrait.alphaBounds;
    const scale = Math.min(150 / bounds.height, 160 / bounds.width);
    const ctx = imageCanvas.getContext('2d');
    ctx.drawImage(textures.get(fighter.path), bounds.x, bounds.y, bounds.width, bounds.height, 120 - bounds.width * scale / 2, 178 - bounds.height * scale, bounds.width * scale, bounds.height * scale);
    button.addEventListener('click', () => { if (!match) selectFighter(fighter.id); });
    $('fighters-grid').append(button);
  }
  const stages = [...catalog.backgrounds].sort((a, b) => (a.id === 'patio' ? -1 : b.id === 'patio' ? 1 : 0));
  for (const [index, stage] of stages.entries()) {
    const button = document.createElement('button'); button.className = 'stage-card'; button.dataset.stage = stage.id;
    button.setAttribute('aria-label', `Elegir escenario ${stage.name}`); button.setAttribute('aria-pressed', String(stage.id === selectedStage));
    const image = document.createElement('img'); image.src = assetUrl(stage.path); image.alt = ''; image.loading = 'lazy';
    const title = document.createElement('span'); title.textContent = stage.name.toUpperCase();
    const number = document.createElement('span'); number.className = 'stage-index'; number.textContent = String(index + 1).padStart(2, '0');
    button.append(image, title, number); button.addEventListener('click', () => { if (!match) selectStage(stage.id); });
    $('stages-grid').append(button);
  }
  selectFighter(selectedFighter);
  selectStage(selectedStage);
}

function selectFighter(id) {
  selectedFighter = id;
  document.querySelectorAll('[data-fighter]').forEach(button => {
    const selected = button.dataset.fighter === id;
    button.setAttribute('aria-pressed', String(selected));
    button.querySelector('.fighter-badge').hidden = !selected;
    button.querySelector('.fighter-description>span:last-child').textContent = selected ? 'ELEGIDO' : '+';
  });
  $('selected-label').textContent = `${fighterById(id).name.toUpperCase()} · LISTO PARA EL SIGUIENTE ROUND`;
  updateCancelGuide();
  announce(`${fighterById(id).name} seleccionado`);
}
function selectStage(id) {
  selectedStage = id;
  document.querySelectorAll('[data-stage]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stage === id)));
  $('stage-title').textContent = stageById(id).name.toUpperCase();
  const stageIndex = [...document.querySelectorAll('[data-stage]')].findIndex(button => button.dataset.stage === id) + 1;
  document.querySelector('.caption-label').textContent = `ESCENARIO ${String(stageIndex).padStart(2, '0')} / 05`;
  announce(`Escenario: ${stageById(id).name}`);
}
function lockSelection(locked) {
  document.querySelectorAll('[data-fighter],[data-stage]').forEach(button => button.disabled = locked);
  $('difficulty').disabled = locked;
}

function updateCancelGuide() {
  const current = match?.fighters.player;
  const id = current?.id || selectedFighter;
  const profile = getFighterProfile(id);
  $('cancel-fighter').textContent = `CADENA DE ${profile?.name.toUpperCase() || id.toUpperCase()}`;
  $('cancel-route').textContent = formatCancelRoute(id);
  const status = current ? getCancelState(current) : null;
  const playing = match?.status === 'playing' && !match.paused;
  let message = profile?.style || 'Sin cadena de cancelación';
  let ready = false;
  if (current && match.paused) message = 'En pausa';
  else if (current && match.status !== 'playing') message = 'Round terminado · vuelve a intentar tu cadena en la próxima pelea.';
  else if (playing && status?.next && status.confirmed) {
    const cost = ATTACKS[status.next].energy + profile.cancel.cost;
    if (status.sinceHitTicks > profile.cancel.close) message = 'Ventana cerrada · deja terminar la recuperación y vuelve a empezar.';
    else if (current.energy < cost) message = `Necesitas ${cost} de energía para enlazar ${ATTACK_KEYS[status.next]}.`;
    else if (status.next === 'special' && current.specialCooldown > 0) message = 'El especial todavía se está recuperando.';
    else if (status.open) { message = `¡Impacto confirmado! Pulsa ${ATTACK_KEYS[status.next]} para cancelar.`; ready = true; }
    else message = 'Espera tu ventana de enlace y vuelve a pulsar.';
  } else if (playing && current._attack?.chainIndex > 0) message = 'Final de cadena · deja terminar la recuperación.';
  else if (playing) message = `Acércate, empieza con ${ATTACK_KEYS[profile?.route[0]] || 'J'} y confirma el impacto.`;
  $('cancel-status').textContent = message;
  $('cancel-status').classList.toggle('ready', ready);
  for (const button of document.querySelectorAll('[data-control]')) {
    button.classList.toggle('cancel-ready', ready && button.dataset.control === status?.next);
  }
}
function clearInput() {
  keyboard.clear(); touch.clear(); queuedPresses.clear();
  document.querySelectorAll('[data-control]').forEach(button => button.classList.remove('pressed'));
}
function getInput() {
  const input = { presses: [...queuedPresses] };
  for (const code of keyboard) input[keyMap[code]] = true;
  for (const control of touch.values()) input[control] = true;
  for (const control of queuedPresses) input[control] = true;
  return input;
}

function startGame() {
  if (!catalog) return;
  clearInput();
  const options = catalog.fighters.filter(fighter => fighter.id !== selectedFighter);
  const opponent = options[Math.floor(Math.random() * options.length)];
  match = createMatch({ playerId: selectedFighter, opponentId: opponent.id, difficulty: $('difficulty').value });
  particles = []; displayedStatus = '';
  $('hud').hidden = false; $('arena-caption').hidden = true;
  $('arena-message').hidden = true; $('pause-button').hidden = false; $('touch-controls').hidden = false;
  $('play-button').textContent = 'NUEVA PARTIDA';
  $('player-name').textContent = fighterById(selectedFighter).name.toUpperCase();
  $('opponent-name').textContent = `${opponent.name.toUpperCase()} · CPU`;
  lockSelection(true); updateHud();
  announce(`Partida iniciada. ${fighterById(selectedFighter).name} contra ${opponent.name}.`);
  playSound('entrada_g', 0.35);
  $('arena-shell').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' });
  $('pause-button').focus({ preventScroll: true });
}
function returnToSelection() {
  match = null; particles = []; clearInput();
  $('hud').hidden = true; $('arena-caption').hidden = false; $('arena-message').hidden = true;
  $('pause-button').hidden = true; $('touch-controls').hidden = true;
  $('play-button').textContent = 'ENTRAR AL PATIO'; $('arena-state').textContent = 'EL PATIO TE ESPERA'; $('round-label').textContent = 'PARTIDA RÁPIDA';
  lockSelection(false); selectFighter(selectedFighter);
  $('play-button').focus({ preventScroll: true });
}
function showMessage(eyebrow, title, copy, buttonText, action) {
  $('message-eyebrow').textContent = eyebrow; $('message-title').textContent = title; $('message-copy').textContent = copy;
  $('continue-button').textContent = buttonText; $('continue-button').onclick = action;
  $('arena-message').hidden = false;
  $('pause-button').hidden = true;
  $('continue-button').focus({ preventScroll: true });
  announce(`${title}. ${copy}`);
}
function pauseGame() {
  if (!match || match.status !== 'playing') return;
  if (match.paused) { resumeGame(); return; }
  setPaused(match, true); clearInput(); $('arena-state').textContent = 'PARTIDA EN PAUSA';
  updateCancelGuide();
  showMessage('TÓMATE UN RESPIRO', 'PAUSA', 'El patio puede esperar un momento.', 'CONTINUAR', resumeGame);
}
function resumeGame() {
  if (!match || match.status !== 'playing') return;
  clearInput(); setPaused(match, false); $('arena-message').hidden = true; $('pause-button').hidden = false;
  $('pause-button').focus({ preventScroll: true }); displayedStatus = ''; updateHud();
}
function showResult() {
  if (match.status === 'roundOver') {
    const title = match.roundWinner === 'player' ? 'ROUND PARA TI' : match.roundWinner === 'draw' ? 'EMPATE' : 'ROUND PARA LA CPU';
    const { player, opponent } = match.fighters;
    showMessage(`ROUND ${match.round} COMPLETADO`, title, `Marcador ${player.wins} — ${opponent.wins}. Aún queda pelea.`, 'SIGUIENTE ROUND', () => {
      clearInput(); startNextRound(match); displayedStatus = ''; particles = [];
      $('arena-message').hidden = true; $('pause-button').hidden = false; updateHud();
      $('pause-button').focus({ preventScroll: true });
    });
  } else if (match.status === 'finished') {
    const won = match.winner === 'player';
    if (won) {
      wins += 1; $('wins-count').textContent = String(wins).padStart(2, '0');
      try { localStorage.setItem('puente-grande-wins', String(wins)); } catch { /* Optional persistence. */ }
    }
    const title = won ? 'EL PATIO ES TUYO' : match.winner === 'draw' ? 'NADIE SE RINDE' : 'HABRÁ REVANCHA';
    const score = `${match.fighters.player.wins} — ${match.fighters.opponent.wins}`;
    showMessage('FIN DE LA PARTIDA', title, `${score} · ${won ? 'Dejaste tu marca. ¿Otra pelea?' : 'Cada round te hace mejor. Vuelve al ruedo.'}`, 'REVANCHA', startGame);
    playSound('remate_g', 0.3);
  }
}
function updateHud() {
  if (!match) return;
  for (const side of ['player', 'opponent']) {
    const fighter = match.fighters[side];
    $(`${side}-health`).style.width = `${fighter.health}%`;
    $(`${side}-health-text`).textContent = `${Math.ceil(fighter.health)} HP`;
    $(`${side}-energy`).style.width = `${fighter.energy}%`;
    $(`${side}-health`).parentElement.setAttribute('aria-valuenow', String(Math.ceil(fighter.health)));
    $(`${side}-energy`).parentElement.setAttribute('aria-valuenow', String(Math.round(fighter.energy)));
  }
  $('timer').textContent = String(Math.ceil(match.timeLeft)).padStart(2, '0');
  $('round-label').textContent = `ROUND ${match.round} · ${match.fighters.player.wins} — ${match.fighters.opponent.wins}`;
  $('arena-state').textContent = match.paused ? 'PARTIDA EN PAUSA' : match.status === 'playing' ? 'EN COMBATE' : match.status === 'finished' ? 'PARTIDA COMPLETADA' : 'ROUND COMPLETADO';
  updateCancelGuide();
}

function playSound(id, volume = 0.35) {
  if (!soundOn || !catalog) return;
  const metadata = catalog.audio.find(audio => audio.id === id);
  if (!metadata) return;
  let pool = audioPool.get(id);
  if (!pool) { pool = []; audioPool.set(id, pool); }
  let audio = pool.find(item => item.paused || item.ended);
  if (!audio && pool.length < 4) {
    // Use a typed source because some uploaded .wav files actually contain Ogg.
    audio = new Audio(); const source = document.createElement('source');
    source.src = assetUrl(metadata.path); source.type = metadata.mime; audio.append(source); pool.push(audio);
  }
  if (!audio) return;
  audio.currentTime = 0; audio.volume = volume;
  audio.play().catch(() => announce('No se pudo reproducir el sonido en este navegador. Puedes seguir jugando.'));
}
$('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn; $('sound-toggle').setAttribute('aria-pressed', String(soundOn));
  $('sound-toggle').setAttribute('aria-label', soundOn ? 'Desactivar sonido' : 'Activar sonido');
  $('sound-label').textContent = soundOn ? 'Sonido activado' : 'Sonido apagado';
  if (soundOn) playSound('punchLight', 0.3);
  else for (const pool of audioPool.values()) for (const audio of pool) audio.pause();
});

function renderFighter(fighter, time, preview = false) {
  const info = fighterById(fighter.id);
  const image = textures.get(info.path);
  const { animation, column } = resolveAnimationFrame(info, fighter, {
    preview, previewTime: time, reducedMotion,
    duration: getAttackDefinition(fighter)?.duration || fighter.actionDuration,
  });
  const scale = info.frameHeight === 120 ? 1.92 : 1.72;
  const width = info.frameWidth * scale;
  const height = info.frameHeight * scale;
  const ground = ARENA.groundY + 5;
  context.save();
  context.fillStyle = '#05090770';
  context.beginPath(); context.ellipse(fighter.x, ground + 2, 47, 9, 0, 0, Math.PI * 2); context.fill();
  context.translate(fighter.x, ground - fighter.y);
  context.scale(fighter.facing, 1);
  if (fighter.action === 'special') { context.shadowColor = '#ff9a58'; context.shadowBlur = reducedMotion ? 0 : 24; }
  context.drawImage(image, column * info.frameWidth, animation.row * info.frameHeight, info.frameWidth, info.frameHeight, -width / 2, -height + 12, width, height);
  if (fighter.action === 'block') {
    context.strokeStyle = '#acd9ea99'; context.lineWidth = 3; context.beginPath(); context.arc(0, -95, 57, -1.4, 1.4); context.stroke();
  }
  if (fighter.action === 'special' && !reducedMotion) {
    context.strokeStyle = '#ff784766'; context.lineWidth = 7; context.beginPath(); context.arc(36, -90, 48 + Math.sin(time * 16) * 8, -1.3, 1.3); context.stroke();
  }
  context.restore();
}
function handleEvents() {
  for (const event of match.events) {
    if (event.type === 'hit') {
      if (!reducedMotion) for (let i = 0; i < 9; i += 1) particles.push({ x: event.x, y: ARENA.groundY - event.y - 100, vx: (Math.random() - 0.5) * 310, vy: (Math.random() - 0.8) * 220, life: 0.28, color: event.blocked ? '#b9dfe6' : '#ffd483' });
      playSound(event.blocked ? 'grab' : 'punchHeavy', 0.25);
    } else if (event.type === 'punch') playSound('punchLight', 0.25);
    else if (event.type === 'kick') playSound('kickLight', 0.3);
    else if (event.type === 'special') playSound('special', 0.3);
    else if (event.type === 'cancel') announce(`Cancelación: ${ATTACK_KEYS[event.from] || ''} a ${ATTACK_KEYS[event.to] || ''}.`);
  }
}
function render(dt) {
  if (!catalog) return;
  const stage = stageById(selectedStage);
  context.drawImage(textures.get(stage.path), 0, 0, ARENA.width, ARENA.height);
  context.fillStyle = '#0c140f24'; context.fillRect(0, 0, ARENA.width, ARENA.height);
  if (match) {
    renderFighter(match.fighters.player, elapsed);
    renderFighter(match.fighters.opponent, elapsed);
  } else {
    const opponent = catalog.fighters.find(fighter => fighter.id !== selectedFighter && fighter.id === 'mateo') || catalog.fighters.find(fighter => fighter.id !== selectedFighter);
    renderFighter({ id: selectedFighter, x: 580, y: 0, facing: 1, action: 'idle' }, elapsed, true);
    renderFighter({ id: opponent.id, x: 785, y: 0, facing: -1, action: 'idle' }, elapsed + 0.3, true);
  }
  for (const particle of particles) {
    if (!match?.paused) { particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; }
    context.globalAlpha = Math.max(0, particle.life / 0.28); context.fillStyle = particle.color; context.fillRect(particle.x, particle.y, 4, 4);
  }
  context.globalAlpha = 1; particles = particles.filter(particle => particle.life > 0);
}
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05); lastFrame = now;
  if (!match?.paused) elapsed += dt;
  if (match && !match.paused && match.status === 'playing') {
    stepMatch(match, dt, getInput()); queuedPresses.clear(); handleEvents(); updateHud();
    if (match.status !== 'playing' && match.status !== displayedStatus) { displayedStatus = match.status; showResult(); }
  }
  render(dt); requestAnimationFrame(frame);
}

$('play-button').addEventListener('click', startGame);
$('pause-button').addEventListener('click', pauseGame);
$('back-button').addEventListener('click', returnToSelection);
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && match && match.status === 'playing') { event.preventDefault(); if (!event.repeat) pauseGame(); return; }
  if (!keyMap[event.code] || !match || match.paused || match.status !== 'playing' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  event.preventDefault(); keyboard.add(event.code);
  if (!event.repeat && edgeControls.has(keyMap[event.code])) queuedPresses.add(keyMap[event.code]);
});
window.addEventListener('keyup', event => {
  keyboard.delete(event.code);
  if (event.code === 'Space' || event.code === 'Enter') {
    for (const key of touch.keys()) if (String(key).startsWith('key-')) touch.delete(key);
    document.querySelectorAll('[data-control]').forEach(button => {
      if (![...touch.values()].includes(button.dataset.control)) button.classList.remove('pressed');
    });
  }
});
window.addEventListener('blur', () => { clearInput(); if (match?.status === 'playing' && !match.paused) pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (match?.status === 'playing' && !match.paused) pauseGame(); } });
for (const button of document.querySelectorAll('[data-control]')) {
  button.addEventListener('pointerdown', event => {
    if (!match || match.paused || match.status !== 'playing') return;
    event.preventDefault(); button.setPointerCapture(event.pointerId); touch.set(event.pointerId, button.dataset.control); button.classList.add('pressed');
    if (edgeControls.has(button.dataset.control)) queuedPresses.add(button.dataset.control);
  });
  const release = event => { touch.delete(event.pointerId); if (![...touch.values()].includes(button.dataset.control)) button.classList.remove('pressed'); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  // Keyboard users can activate the visible control buttons too.
  button.addEventListener('keydown', event => {
    if ((event.code === 'Space' || event.code === 'Enter') && match?.status === 'playing' && !match.paused) {
      event.preventDefault(); touch.set(`key-${button.dataset.control}`, button.dataset.control); button.classList.add('pressed');
      if (!event.repeat && edgeControls.has(button.dataset.control)) queuedPresses.add(button.dataset.control);
    }
  });
  button.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'Enter') { touch.delete(`key-${button.dataset.control}`); button.classList.remove('pressed'); } });
  button.addEventListener('blur', () => { touch.delete(`key-${button.dataset.control}`); button.classList.remove('pressed'); });
  button.addEventListener('click', event => {
    if (event.detail !== 0 || !match || match.paused || match.status !== 'playing') return;
    const key = `assistive-${button.dataset.control}`;
    touch.set(key, button.dataset.control);
    if (edgeControls.has(button.dataset.control)) queuedPresses.add(button.dataset.control);
    setTimeout(() => touch.delete(key), 100);
  });
}

async function init() {
  try {
    const response = await fetch(assetUrl('assets/catalog.json'));
    if (!response.ok) throw new Error('Catálogo no disponible');
    catalog = await response.json();
    await Promise.all([...catalog.fighters, ...catalog.backgrounds].map(item => loadImage(item.path)));
    buildSelection(); $('loading-message').hidden = true; $('play-button').disabled = false;
    $('arena-state').textContent = 'EL PATIO TE ESPERA'; requestAnimationFrame(frame);
  } catch (error) {
    $('loading-message').textContent = 'No pudimos cargar el patio. Recarga la página para intentarlo de nuevo.';
    announce('Error al cargar los recursos del juego.'); console.error(error);
  }
}
init();
