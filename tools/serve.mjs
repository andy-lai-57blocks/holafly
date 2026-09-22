// Serves dist/ on every interface and tells the preview page which address a
// phone should use, so the QR resolves off this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve('dist');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries || []) {
      if (e.family === 'IPv4' && !e.internal) return e.address;
    }
  }
  return null;
}

const lan = lanAddress();
const lanOrigin = lan ? `http://${lan}:${PORT}` : null;

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  if (rel === '') rel = 'preview/index.html';

  let file = path.join(ROOT, rel);
  if (!path.resolve(file).startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: /${rel}`); return; }

    const type = MIME[path.extname(file)] || 'application/octet-stream';
    let body = buf;

    // Tell the preview shell where it is reachable from. Only the shell needs
    // this; the creatives are untouched.
    if (path.resolve(file) === path.join(ROOT, 'preview', 'index.html') && lanOrigin) {
      body = Buffer.from(
        buf.toString('utf8').replace('<body>', `<body>\n<script>window.__PREVIEW_HOST__=${JSON.stringify(lanOrigin)};</script>`),
      );
    }

    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  preview   http://localhost:${PORT}/`);
  if (lanOrigin) console.log(`  on phone  ${lanOrigin}/   (same Wi-Fi — or just scan the QR on the page)`);
  else console.log('  no LAN address found; the QR will only work on this machine');
  console.log('\n  creatives');
  for (const slug of fs.readdirSync(path.join(ROOT, 'packages')).filter((d) => fs.statSync(path.join(ROOT, 'packages', d)).isDirectory())) {
    console.log(`    /packages/${slug}/`);
  }
  console.log('');
});
