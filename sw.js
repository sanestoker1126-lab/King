// Service worker mínimo: habilita el registro PWA, pero no cachea
// archivos durante el desarrollo para evitar versiones mezcladas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
