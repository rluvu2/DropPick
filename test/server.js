// 정적 파일 서버 (빌드 없음). node test/server.js [포트]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

function serve(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(ROOT, '.' + p);
    if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}node_modules${path.sep}.`)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(port || 0, '127.0.0.1', () => resolve(server)));
}

if (require.main === module) {
  serve(+process.argv[2] || 8080).then(s => console.log(`http://localhost:${s.address().port}/`));
}
module.exports = { serve, ROOT };
