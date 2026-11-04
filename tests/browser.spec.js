import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.runtimeFailures = failures;
  if (testInfo.title.includes('complete rounds') || testInfo.title.includes('brief inputs') || testInfo.title.includes('cancel chain')) {
    const virtualStart = new Date('2026-10-06T12:00:00Z');
    await page.clock.install({ time: virtualStart });
    await page.clock.pauseAt(new Date(virtualStart.getTime() + 500));
  }
  await page.goto('/');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#loading-message')).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
});

test.afterEach(async ({ page }) => {
  expect(page.runtimeFailures, 'The complete flow must have no browser or asset-loading errors').toEqual([]);
});

async function canvasFrame(page) {
  // Wait until the game's next rendered frame after a selection/input change.
  return page.locator('#game-canvas').evaluate(canvas => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(canvas.toDataURL())));
  }));
}

async function beginMatch(page) {
  await page.locator('#difficulty').selectOption('easy');
  await page.locator('#play-button').click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#arena-state')).toHaveText('EN COMBATE');
  await expect(page.locator('#player-health-text')).toHaveText('100 HP');
  await expect(page.locator('#opponent-health-text')).toHaveText('100 HP');
  await expect(page.getByRole('meter', { name: 'Salud de tu luchador', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('meter', { name: 'Salud del rival', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('#round-label')).toHaveText('ROUND 1 · 0 — 0');
  await expect(page.locator('#difficulty')).toBeDisabled();
  await expect(page.locator('[data-fighter="tobi"]')).toBeDisabled();
}

async function pauseAndReturn(page) {
  await page.locator('#pause-button').click();
  await expect(page.locator('#message-title')).toHaveText('PAUSA');
  const frozenTimer = await page.locator('#timer').textContent();
  const frozenHealth = await page.locator('#player-health-text').textContent();
  const frozenCanvas = await canvasFrame(page);
  await page.waitForTimeout(1200); // Longer than one displayed timer tick.
  await expect(page.locator('#timer')).toHaveText(frozenTimer);
  await expect(page.locator('#player-health-text')).toHaveText(frozenHealth);
  expect(await canvasFrame(page)).toBe(frozenCanvas);
  await page.locator('#continue-button').click();
  await expect(page.locator('#arena-message')).toBeHidden();
  await expect.poll(async () => Number(await page.locator('#timer').textContent())).toBeLessThan(Number(frozenTimer));
  await page.locator('#pause-button').click();
  await page.locator('#back-button').click();
  await expect(page.locator('#hud')).toBeHidden();
  await expect(page.locator('#touch-controls')).toBeHidden();
  await expect(page.locator('#difficulty')).toBeEnabled();
  await expect(page.locator('[data-fighter="nadia"]')).toBeEnabled();
  await page.locator('[data-fighter="nadia"]').click();
  await page.locator('#play-button').click();
  await expect(page.locator('#player-name')).toHaveText('NADIA');
  await expect(page.locator('#player-health-text')).toHaveText('100 HP');
  await expect(page.locator('#opponent-health-text')).toHaveText('100 HP');
  await expect(page.locator('#round-label')).toHaveText('ROUND 1 · 0 — 0');
  await expect.poll(async () => Number(await page.locator('#timer').textContent())).toBeGreaterThanOrEqual(44);
}

test('all six fighters and five stages load and change the arena preview', async ({ page }, testInfo) => {
  await page.screenshot({ path: `/tmp/puente-grande-${testInfo.project.name}.png`, fullPage: true });
  const portraits = await page.locator('.fighter-portrait canvas').evaluateAll(canvases => canvases.map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted;
  }));
  expect(portraits).toHaveLength(6);
  expect(portraits.every(painted => painted > 200)).toBe(true);

  const previewFrames = new Set();
  for (const [id, name] of [['tobi', 'TOBI'], ['mateo', 'MATEO'], ['nadia', 'NADIA'], ['semillas', 'SEMILLAS'], ['oscuro', 'OSCURO'], ['callejero', 'CALLEJERO']]) {
    await page.locator(`[data-fighter="${id}"]`).click();
    await expect(page.locator(`[data-fighter="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-fighter][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#selected-label')).toContainText(name);
    previewFrames.add(await canvasFrame(page));
  }
  expect(previewFrames.size, 'Each selected fighter should produce its own arena preview').toBe(6);

  const stageFrames = new Set();
  for (const [id, name] of [['patio', 'EL PATIO'], ['exterior', 'EL RECLUSORIO'], ['interior', 'LOS PASILLOS'], ['mercado', 'EL MERCADO'], ['carretera', 'LA CARRETERA']]) {
    const card = page.locator(`[data-stage="${id}"]`);
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-stage][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#stage-title')).toHaveText(name);
    expect(await card.locator('img').evaluate(image => image.complete && image.naturalWidth > 100)).toBe(true);
    stageFrames.add(await canvasFrame(page));
  }
  expect(stageFrames.size, 'Stage selections must change the actual arena artwork').toBe(5);
});

test('desktop keyboard combat changes health and energy; pause, resume and return work', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Covered by touch controls on mobile');
  await beginMatch(page);
  await page.keyboard.down('k');
  await page.waitForTimeout(80);
  await page.keyboard.up('k');
  await page.waitForTimeout(500);
  await expect(page.locator('#opponent-health-text')).toHaveText('100 HP'); // Out-of-range attacks miss.

  await page.keyboard.down('d');
  await page.waitForTimeout(750);
  for (let i = 0; i < 8 && (await page.locator('#opponent-health-text').textContent()) === '100 HP'; i++) {
    await page.keyboard.down(i % 2 ? 'j' : 'k');
    await page.waitForTimeout(80);
    await page.keyboard.up(i % 2 ? 'j' : 'k');
    await page.waitForTimeout(510);
  }
  await page.keyboard.up('d');
  await expect.poll(async () => Number.parseInt(await page.locator('#opponent-health-text').textContent())).toBeLessThan(100);
  expect(Number(await page.getByRole('meter', { name: 'Salud del rival', exact: true }).getAttribute('aria-valuenow'))).toBeLessThan(100);
  await page.waitForTimeout(500);
  const initialEnergy = await page.locator('#player-energy').evaluate(element => Number.parseFloat(element.style.width));
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('l');
    await page.waitForTimeout(80);
    await page.keyboard.up('l');
    if (await page.locator('#player-energy').evaluate(element => Number.parseFloat(element.style.width)) < initialEnergy - 20) break;
    await page.waitForTimeout(500);
  }
  expect(await page.locator('#player-energy').evaluate(element => Number.parseFloat(element.style.width))).toBeLessThan(initialEnergy - 20);
  expect(Number(await page.getByRole('meter', { name: 'Energía de tu luchador', exact: true }).getAttribute('aria-valuenow'))).toBeLessThan(initialEnergy - 20);
  await pauseAndReturn(page);
});

test('accessible controls release movement after focus changes and accept assistive activation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop keyboard focus regression');
  await beginMatch(page);
  const playerCenter = () => page.locator('#game-canvas').evaluate(async canvas => {
    const image = new Image();
    image.src = document.querySelector('[data-stage="patio"] img').src;
    await image.decode();
    const background = document.createElement('canvas');
    background.width = canvas.width; background.height = canvas.height;
    const ctx = background.getContext('2d');
    ctx.drawImage(image, 0, 0, background.width, background.height);
    ctx.fillStyle = '#0c140f24'; ctx.fillRect(0, 0, background.width, background.height);
    const scene = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const reference = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = 420; let maxX = 0;
    // The other fighter and floor shadow lie outside this initial player region.
    for (let y = 20; y < 340; y++) for (let x = 80; x < 420; x++) {
      const offset = (y * canvas.width + x) * 4;
      const difference = Math.abs(scene[offset] - reference[offset]) + Math.abs(scene[offset + 1] - reference[offset + 1]) + Math.abs(scene[offset + 2] - reference[offset + 2]);
      if (difference > 90) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    return (minX + maxX) / 2;
  });
  const right = page.getByRole('button', { name: 'Mover a la derecha', exact: true });
  const initialPosition = await playerCenter();
  await right.focus();
  await page.keyboard.down('Space');
  await expect(right).toHaveClass(/pressed/);
  await page.waitForTimeout(250);
  await page.keyboard.press('Tab');
  await page.keyboard.up('Space');
  await expect(right).not.toHaveClass(/pressed/);
  const releasePosition = await playerCenter();
  expect(releasePosition - initialPosition).toBeGreaterThan(25);
  await page.waitForTimeout(500);
  expect(Math.abs((await playerCenter()) - releasePosition), 'Released movement must stop even when keyup targets another control').toBeLessThan(20);

  await page.locator('#play-button').click(); // Reset recovery/energy before assistive activation.
  await page.locator('[data-control="special"]').evaluate(button => button.click());
  await expect.poll(async () => Number(await page.getByRole('meter', { name: 'Energía de tu luchador', exact: true }).getAttribute('aria-valuenow'))).toBeLessThan(80);
});

test('mobile fits the viewport and pointer controls perform combat actions', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile touch interaction coverage');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await beginMatch(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#touch-controls').scrollIntoViewIfNeeded();
  const client = await context.newCDPSession(page);
  const positions = {};
  for (const control of ['right', 'kick', 'special']) {
    const box = await page.locator(`[data-control="${control}"]`).boundingBox();
    positions[control] = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const finger = (id, control) => ({ id, ...positions[control] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, 'right')] });
  await expect(page.locator('[data-control="right"]')).toHaveClass(/pressed/);
  await page.waitForTimeout(900);
  for (let i = 0; i < 8 && (await page.locator('#opponent-health-text').textContent()) === '100 HP'; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, 'right'), finger(2, 'kick')] });
    await expect(page.locator('[data-control="kick"]')).toHaveClass(/pressed/);
    await page.waitForTimeout(80);
    // CDP ends the active touch sequence with an empty list; reapply both fingers
    // on the next strike to exercise movement and attack simultaneously.
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('[data-control="kick"]')).not.toHaveClass(/pressed/);
    await page.waitForTimeout(510);
  }
  await expect(page.locator('[data-control="right"]')).not.toHaveClass(/pressed/);
  await expect.poll(async () => Number.parseInt(await page.locator('#opponent-health-text').textContent())).toBeLessThan(100);
  await page.waitForTimeout(500);
  for (let i = 0; i < 4; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(3, 'special')] });
    await page.waitForTimeout(80);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (await page.locator('#player-energy').evaluate(element => Number.parseFloat(element.style.width)) < 80) break;
    await page.waitForTimeout(500);
  }
  expect(await page.locator('#player-energy').evaluate(element => Number.parseFloat(element.style.width))).toBeLessThan(80);
  await pauseAndReturn(page);
});

test('brief inputs released before the next frame still trigger their attack', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Deterministic keyboard input regression');
  await beginMatch(page);
  const energy = page.getByRole('meter', { name: 'Energía de tu luchador', exact: true });
  await expect(energy).toHaveAttribute('aria-valuenow', '100');
  // Both native keyboard events occur before any animation frame can consume
  // the input. The queued press must survive keyup and reach the next frame.
  await page.keyboard.down('l');
  await page.keyboard.up('l');
  await expect(energy).toHaveAttribute('aria-valuenow', '100');
  await page.clock.runFor(50);
  expect(Number(await energy.getAttribute('aria-valuenow'))).toBeLessThan(80);
});

test('complete rounds preserve the score, finish the match and allow a rematch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Full round UI integration uses the desktop browser clock');
  test.setTimeout(60_000);
  await page.locator('#difficulty').selectOption('hard');
  await page.locator('#play-button').click();
  const waitForRound = async () => {
    // Run real animation frames against virtual browser time, without changing
    // game state or replacing the CPU. An idle player loses to the hard CPU.
    for (let i = 0; i < 9 && !(await page.locator('#arena-message').isVisible()); i++) await page.clock.runFor(5000);
    await expect(page.locator('#arena-message')).toBeVisible();
  };
  await waitForRound();
  await expect(page.locator('#message-title')).toHaveText('ROUND PARA LA CPU');
  await expect(page.locator('#round-label')).toHaveText('ROUND 1 · 0 — 1');
  await expect(page.locator('#continue-button')).toContainText('SIGUIENTE ROUND');
  await page.locator('#continue-button').click();
  await expect(page.locator('#arena-message')).toBeHidden();
  await expect(page.locator('#round-label')).toHaveText('ROUND 2 · 0 — 1');
  await expect(page.locator('#player-health-text')).toHaveText('100 HP');
  await expect(page.locator('#opponent-health-text')).toHaveText('100 HP');
  await expect(page.locator('#timer')).toHaveText('45');
  await waitForRound();
  await expect(page.locator('#message-title')).toHaveText('HABRÁ REVANCHA');
  await expect(page.locator('#arena-state')).toHaveText('PARTIDA COMPLETADA');
  await expect(page.locator('#round-label')).toHaveText('ROUND 2 · 0 — 2');
  await expect(page.locator('#continue-button')).toContainText('REVANCHA');
  await page.locator('#continue-button').click();
  await expect(page.locator('#arena-message')).toBeHidden();
  await expect(page.locator('#round-label')).toHaveText('ROUND 1 · 0 — 0');
  await expect(page.locator('#player-health-text')).toHaveText('100 HP');
  await expect(page.locator('#opponent-health-text')).toHaveText('100 HP');
  await expect(page.locator('#timer')).toHaveText('45');
});

test('enabling sound plays and decodes the supplied Ogg audio', async ({ page }) => {
  // Observe real media created by the app. Playback and decoding remain native.
  await page.evaluate(() => {
    window.observedGameMedia = [];
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (!window.observedGameMedia.includes(this)) window.observedGameMedia.push(this);
      this.addEventListener('playing', () => { this.hasPlayed = true; }, { once: true });
      return originalPlay.apply(this, args);
    };
  });
  const audioResponse = page.waitForResponse(response => response.url().endsWith('/assets/audio/processed/punchLight.ogg') && response.ok());
  await page.getByRole('button', { name: 'Activar sonido', exact: true }).click();
  await audioResponse;
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.observedGameMedia.some(audio =>
    audio.hasPlayed && !audio.error && Number.isFinite(audio.duration) && audio.duration > 0 && audio.readyState >= 2
  ))).toBe(true);
  await expect(page.locator('#announcement')).not.toContainText('No se pudo reproducir');
  await page.getByRole('button', { name: 'Desactivar sonido', exact: true }).click();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.observedGameMedia.every(audio => audio.paused))).toBe(true);
});

test('each fighter presents its own cancel route before the match', async ({ page }) => {
  const routes = { mateo: 'J → K → L', tobi: 'J → J → L', nadia: 'K → J → L', semillas: 'K → K → J', oscuro: 'K → L', callejero: 'J → L → K' };
  for (const [id, route] of Object.entries(routes)) {
    await page.locator(`[data-fighter="${id}"]`).click();
    await expect(page.locator('#cancel-route')).toHaveText(route);
    await expect(page.locator(`[data-fighter="${id}"] .fighter-route`)).toHaveText(route);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cancel chain follows clean hits with keyboard or touch and spends energy', async ({ page }, testInfo) => {
  // A passive, deterministic CPU still moves normally; its attacks/guard use a
  // high random sample. Combat and inputs remain those of the actual application.
  await page.evaluate(() => { Math.random = () => 0.99; });
  await beginMatch(page);
  await page.keyboard.down('d');
  await page.clock.runFor(900);
  await page.keyboard.up('d');
  const strike = async control => {
    if (testInfo.project.name === 'mobile') await page.locator(`[data-control="${control}"]`).tap();
    else await page.keyboard.press({ punch: 'j', special: 'l' }[control]);
  };
  const waitForWindow = async key => {
    for (let frame = 0; frame < 20; frame++) {
      if ((await page.locator('#cancel-status').textContent()).includes(`Pulsa ${key}`)) return;
      await page.clock.runFor(16);
    }
    await expect(page.locator('#cancel-status')).toContainText(`Pulsa ${key}`);
  };
  await strike('punch');
  await waitForWindow('J');
  await expect(page.locator('#opponent-health-text')).toHaveText('91 HP');
  await expect(page.locator('#cancel-status')).toContainText('Pulsa J');
  await expect(page.locator('[data-control="punch"]')).toHaveClass(/cancel-ready/);
  await strike('punch');
  await waitForWindow('L');
  await expect(page.locator('#opponent-health-text')).toHaveText('82 HP');
  await expect(page.locator('#cancel-status')).toContainText('Pulsa L');
  await expect(page.locator('[data-control="special"]')).toHaveClass(/cancel-ready/);
  const energy = page.getByRole('meter', { name: 'Energía de tu luchador', exact: true });
  const beforeSpecial = Number(await energy.getAttribute('aria-valuenow'));
  await strike('special');
  await page.clock.runFor(100);
  await expect(page.locator('#opponent-health-text')).toHaveText('58 HP');
  expect(Number(await energy.getAttribute('aria-valuenow'))).toBeLessThan(beforeSpecial - 30);
  await expect(page.locator('#cancel-status')).toContainText('Final de cadena');
});
