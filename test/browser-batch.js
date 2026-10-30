// 브라우저 안에서 직접 판을 돌린다: 실제 폰트로 Glyph.trace → Sim.Game을 최대 속도로 진행.
// (Node 헤드리스와 같은 코드지만, 브라우저 엔진·실제 글자 모양으로 한 번 더 확인하는 용도)
//   node test/browser-batch.js [판 수] [--pages 8] [--players 30] [--obs 2] [--course long|short] [--mode random|block] [--crowd] [--out file.json]
const fs = require('fs');
const { serve } = require('./server');
const { launch, routeCdn } = require('./browser');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const TOTAL = +argv[0] || 100;
const PAGES = +opt('pages', 8);
const PLAYERS = +opt('players', 30);
const OBS = +opt('obs', 2);
const MODE = opt('mode', 'random');
const CROWD = argv.includes('--crowd');
const OUT = opt('out', null);
const COURSE = opt('course', 'long');
const NAMES = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'fixtures', 'names.json'), 'utf8')).map(g => g.text);

(async () => {
  const server = await serve(0);
  const browser = await launch();
  const ctx = await browser.newContext();
  await routeCdn(ctx, { fake: true });
  const per = Math.ceil(TOTAL / PAGES), t0 = Date.now();
  const parts = await Promise.all([...Array(PAGES).keys()].map(async k => {
    const n = Math.min(per, TOTAL - k * per);
    if (n <= 0) return [];
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.Glyph && window.Sim);
    return page.evaluate(async ({ n, seed0, P, OBS, MODE, CROWD, NAMES, COURSE }) => {
      await Glyph.loadFont(NAMES.join(''));
      const map = Sim.buildMap(COURSE), out = [];
      for (let g = 0; g < n; g++) {
        const rnd = Sim.makeRng(seed0 + g * 31);
        const pool = NAMES.slice(), names = [];
        for (let i = 0; i < P; i++) {
          const text = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
          const s = Glyph.trace(text);
          names.push({ id: 'p' + i, polys: s.polys, w: s.w, h: s.h, x: CROWD ? 15 : s.w / 2 + 0.4 + rnd() * (30 - s.w - 0.8) });
        }
        const obstacles = [], kinds = MODE === 'block' ? ['block', 'block', 'tramp'] : ['block', 'tramp', 'bumper'];
        for (let i = 0; i < P; i++) for (let k = 0; k < OBS; k++) {
          for (let t = 0; t < 40; t++) {
            const kind = kinds[Math.floor(rnd() * kinds.length)];
            const a = MODE === 'block' ? (kind === 'tramp' ? 0 : (rnd() < 0.5 ? 1 : 11) * Math.PI / 12)
              : kind === 'tramp' ? (Math.floor(rnd() * 7) - 3) * Math.PI / 12 : (1 + Math.floor(rnd() * 11)) * Math.PI / 12;
            const o = { id: `o${i}_${k}`, owner: 'p' + i, kind, x: 1 + rnd() * 28, y: 3.5 + rnd() * (map.F - 6), a: Sim.normAngle(kind, a) };   // 코스 어디든
            if (Sim.validateObstacle(map, obstacles, o).ok) { obstacles.push(o); break; }
          }
        }
        const labels = names.map((_, i) => 'L' + i);
        const game = new Sim.Game({ seed: seed0 * 3 + g, map, labels, names, obstacles });
        let sudden = false, rush = false, final = false, teleport = false, unstick = 0, stall = 0, confirms = 0;
        const w0 = performance.now();
        while (!game.over && game.t < 200) {
          game.step();
          for (const e of game.drainEvents()) {
            if (e.t === 'confirm') confirms++;
            else if (e.t === 'sudden') sudden = true;
            else if (e.t === 'rush') rush = true;
            else if (e.t === 'final') final = true;
            else if (e.t === 'unstick') { if (e.level === 9) stall++; else { unstick++; if (e.level >= 3) teleport = true; } }
          }
        }
        const segs = new Set(game.results.map(r => r.seg));
        const ok = game.over && game.results.length === P && segs.size === P && confirms === P;
        out.push({ t: +game.t.toFixed(2), ok, sudden, rush, final, teleport, unstick, stall, nObs: obstacles.length, ms: Math.round(performance.now() - w0) });
      }
      return out;
    }, { n, seed0: 50000 + k * 7919, P: PLAYERS, OBS, MODE, CROWD, NAMES, COURSE });
  }));
  const games = parts.flat(), N = games.length;
  const c = f => games.filter(f).length, pc = k => (100 * k / N).toFixed(2) + '%';
  const times = games.map(g => g.t).sort((a, b) => a - b), q = p => times[Math.min(N - 1, Math.floor(N * p))];
  const sum = {
    where: 'browser', course: COURSE, games: N, players: PLAYERS, obsPer: OBS, mode: MODE, crowd: CROWD,
    fails: c(g => !g.ok), sudden45: pc(c(g => g.sudden)), rush: pc(c(g => g.rush)), final75: pc(c(g => g.final)),
    teleportGames: pc(c(g => g.teleport)), stallGames: pc(c(g => g.stall > 0)), anyRescue: pc(c(g => g.unstick + g.stall > 0)),
    time: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: times[N - 1] },
    avgSimMsPerGame: Math.round(games.reduce((s, g) => s + g.ms, 0) / N), wallSeconds: Math.round((Date.now() - t0) / 1000),
  };
  console.log(JSON.stringify(sum, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(Object.assign(sum, { perGame: games }), null, 1));
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
