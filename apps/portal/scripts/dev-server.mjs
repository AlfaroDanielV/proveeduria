import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'src');
const port = Number.parseInt(process.env.PORT ?? '5173', 10);

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

function resolvePath(pathname) {
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const rel = clean === '/' ? 'index.html' : clean.replace(/^[/\\]/, '');
  return join(publicDir, rel);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const filePath = resolvePath(url.pathname);
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  console.log(`apps/portal dev en http://localhost:${port}`);
});
