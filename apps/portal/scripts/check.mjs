import { access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const required = ['src/index.html', 'src/styles.css', 'src/app.js'];

for (const rel of required) {
  await access(join(root, rel));
}

const html = await readFile(join(root, 'src/index.html'), 'utf8');
const js = await readFile(join(root, 'src/app.js'), 'utf8');

if (!html.includes('<main class="shell">')) {
  throw new Error('index.html no contiene el layout principal esperado.');
}

for (const endpoint of ['/api/portal/me', '/api/portal/pedidos']) {
  if (!js.includes(endpoint)) {
    throw new Error(`app.js no referencia ${endpoint}.`);
  }
}

console.log('Portal check OK');
