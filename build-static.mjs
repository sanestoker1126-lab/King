// Exportación estática completa: conserva todas las rutas relativas de assets.
import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve('dist');
await rm(out, { recursive:true, force:true });
await mkdir(out, { recursive:true });
for (const dir of ['assets', 'data', 'engine', 'styles']) {
  await cp(resolve(dir), resolve(out, dir), { recursive:true });
}
for (const file of ['index.html', 'game.html', 'manifest.webmanifest', 'sw.js']) {
  await copyFile(resolve(file), resolve(out, file));
}
console.log('Compilación estática creada en dist/ sin modificar código ni sprites.');
