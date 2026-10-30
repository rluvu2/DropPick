// 호스트 화면 성능: 폰 없이 "폰 없는 사람" 30명을 추가해 한 판을 돌리고 fps·스텝 비용을 잰다.
//   node test/host-perf.js [인원 30] [판 수 2]
const path = require('path');
const fs = require('fs');
const { serve } = require('./server');
const { launch, routeCdn, watch } = require('./browser');
const NAMES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'names.json'), 'utf8')).map(g => g.text);
const N = +process.argv[2] || 30, GAMES = +process.argv[3] || 2;

(async () => {
  const server = await serve(0);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeCdn(ctx, { fake: true });
  const bag = { errors: [], resource: [] };
  const host = await ctx.newPage();
  watch(host, 'host', bag);
  await host.goto(`http://127.0.0.1:${server.address().port}/`);
  await host.fill('#labels', '커피 쏘기\n간식 쏘기\n꽝*' + Math.max(1, N - 2));
  await host.click('#openRoom');
  await host.waitForSelector('#hLobby:not(.hidden)');
  for (let i = 0; i < N; i++) {
    await host.fill('#addName', NAMES[i]);
    await host.click('#addForm button');
  }
  await host.waitForFunction(n => PLB.st.players.filter(p => p.name).length === n, N);
  const out = [];
  for (let g = 0; g < GAMES; g++) {
    await host.evaluate(() => {
      PLB.st.stats = { frames: 0, slowFrames: 0, maxSteps: 0, stepMs: 0, steps: 0 };
      window.__ft = []; let last = performance.now();
      (function f(t) { const g = PLB.st.game; window.__ft.push([t - last, PLB.st.phase, g ? g.remaining : -1, g ? +g.t.toFixed(2) : 0, PLB.st.stageSeen, PLB.st.inset ? 1 : 0, document.getElementById('banner').textContent.slice(0, 12)]); last = t; if (PLB.st.phase !== 'done') requestAnimationFrame(f); })(performance.now());
    });
    const w0 = Date.now();
    await host.click('#startBtn');
    await host.waitForFunction(() => PLB.st.phase === 'done', null, { timeout: 300000, polling: 1000 });
    const r = await host.evaluate(() => {
      const all = window.__ft.slice(1), run = all.filter(x => x[1] === 'running'); window.__long = all.filter(x => x[0] > 60).slice(0, 14); const ft = run.map(x => x[0]).sort((a, b) => a - b), q = p => ft[Math.min(ft.length - 1, Math.floor(ft.length * p))];
      const s = PLB.st.stats;
      return { gameSec: +PLB.st.game.t.toFixed(1), results: PLB.st.results.length, frames: ft.length, frameMsP50: +q(0.5).toFixed(1), frameMsP90: +q(0.9).toFixed(1), frameMsMax: +ft[ft.length - 1].toFixed(0), stepMs: +(s.stepMs / Math.max(1, s.steps)).toFixed(2), slowFrames: s.slowFrames, long: window.__long.map(x => x.map(v => typeof v === 'number' ? +v.toFixed(1) : v)) };
    });
    r.wallSec = +((Date.now() - w0) / 1000).toFixed(1);
    r.speed = +(r.gameSec / Math.max(0.1, r.wallSec - 3)).toFixed(2);   // 카운트다운 3초 제외, 1이면 실시간
    out.push(r);
    console.log(JSON.stringify(r));
    await host.waitForTimeout(1600);
    await host.click('#againBtn');
  }
  console.log('errors', bag.errors);
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
