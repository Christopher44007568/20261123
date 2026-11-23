import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT) || 8080;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const urlPath = normalize(decodeURIComponent(req.url?.split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, urlPath === '/' ? 'index.html' : urlPath);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => {
  console.log(`serving ${root} at http://localhost:${port}`);
});
