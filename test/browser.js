// Playwright 공용 도우미: 브라우저 실행, CDN → 로컬 파일 라우팅, 콘솔 에러 수집
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const LOCAL = {
  'planck@1.4.2/dist/planck.min.js': 'node_modules/planck/dist/planck.min.js',
  'qrcode-generator@2.0.4/dist/qrcode.js': 'node_modules/qrcode-generator/dist/qrcode.js',
  'peerjs@1.5.5/dist/peerjs.min.js': 'node_modules/peerjs/dist/peerjs.min.js',
};

async function launch() {
  const opts = {
    headless: process.env.HEADED ? false : true,
    // 같은 컴퓨터의 탭끼리 WebRTC를 붙일 때 mDNS 후보가 막히는 경우가 있어서 끈다 (테스트 환경 전용)
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  };
  const channel = process.env.BROWSER_CHANNEL || 'msedge';
  try { return await chromium.launch(Object.assign({ channel }, opts)); }
  catch (e) { return chromium.launch(opts); }
}

// fake: true면 PeerJS 대신 test/fakepeer.js를 준다
async function routeCdn(context, { fake }) {
  await context.route('https://cdn.jsdelivr.net/npm/**', route => {
    const key = route.request().url().split('/npm/')[1];
    let file = LOCAL[key];
    if (fake && key.startsWith('peerjs@')) file = 'test/fakepeer.js';
    if (!file) return route.continue();
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(path.join(ROOT, file)) });
  });
}

// PeerJS 공용 서버의 일시적인 신호 서버 오류. 앱(net.js)이 새 Peer로 다시 시도하므로,
// 다른 검사(전원 입장·결과 수신)가 통과하면 문제가 아니다. 따로 세어 보고만 한다
const PEER_SERVER = /PeerJS: .*(Error retrieving ID|Could not get an ID from the server|Aborting!|Lost connection to server)/;

// 콘솔 에러·페이지 에러 수집 (폰트처럼 외부 리소스 실패, PeerJS 서버 일시 오류는 따로 센다)
function watch(page, label, bag) {
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/.test(text)) { bag.resource.push(`${label}: ${text}`); return; }
    if (PEER_SERVER.test(text)) { (bag.network = bag.network || []).push(`${label}: ${text}`); return; }
    bag.errors.push(`${label}: ${text}`);
  });
  page.on('pageerror', err => bag.errors.push(`${label}: pageerror ${err.message}`));
}

module.exports = { launch, routeCdn, watch, ROOT };
