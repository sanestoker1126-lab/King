// Servidor web estático sin dependencias para AI Studio / Node 20+.
// No modifica el motor de combate ni reescribe rutas de los atlas.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 3000);
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.gif':'image/gif', '.ico':'image/x-icon',
  '.wav':'audio/wav', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.m4a':'audio/mp4',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.txt':'text/plain; charset=utf-8', '.wasm':'application/wasm'
};
const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {'Content-Type':'text/plain'}); res.end('Method not allowed'); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const file = resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const headers = {
      'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options':'nosniff'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Archivo no encontrado: ' + pathname);
  }
});
server.listen(port, '0.0.0.0', () => {
  console.log('Legend of Presos disponible en http://0.0.0.0:' + port);
});
