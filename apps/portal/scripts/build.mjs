import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const dist = join(root, 'dist');

await mkdir(dist, { recursive: true });
await Promise.all([
  copyFile(join(src, 'index.html'), join(dist, 'index.html')),
  copyFile(join(src, 'styles.css'), join(dist, 'styles.css')),
  copyFile(join(src, 'app.js'), join(dist, 'app.js')),
]);

console.log(`Portal build listo en ${dist}`);
