// 헤드리스 시뮬레이션: 무작위 참가자·출발 위치·장애물로 여러 판을 돌려
// "모든 판이 끝나는지", "한 칸에 두 명이 들어가는지", 소요 시간 등을 측정한다.
//
//   node test/headless.js [판 수] [시드] [옵션]
//     --players 30      참가자 수 고정 (기본: 2~20 무작위). 범위도 가능: --players 10-30
//     --extra 0         칸 수 = 참가자 수 + 0 (기본: +0~2 무작위)
//     --obs 2           1인당 장애물 시도 개수 (기본 2, 0~5)
//     --mode random     장애물 배치: random(무작위) | block(길막 시도: 납작한 벽돌·트램펄린 위주)
//     --course short    코스: short(31m, 기본) | long(136m)
//     --crowd           모두 같은 출발 위치(가운데)를 고른다 (쌓임·끼임 최악의 경우)
//     --synth           test/fixtures/names.json이 있어도 합성 모양을 쓴다
//     --json out.json   요약을 JSON으로 저장
const fs = require('fs');
const path = require('path');
const Sim = require('../src/sim.js');

const argv = process.argv.slice(2);
const FLAGS = ['--synth', '--crowd'];
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !FLAGS.includes(argv[i - 1])));
const CROWD = argv.includes('--crowd');
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const N = +pos[0] || 100;
const SEED0 = +pos[1] || 1;
const PLAYERS = opt('players', null);
const EXTRA = opt('extra', null);
const OBS_PER = +opt('obs', 2);
const MODE = opt('mode', 'random');
const OUT = opt('json', null);
const COURSE = opt('course', 'short');
if (process.env.G) Sim.C.GRAVITY = +process.env.G;
const map = Sim.buildMap(COURSE);

// 실제 글자 모양 (브라우저에서 Glyph.trace로 뽑은 것). 없으면 합성 모양.
const FIX = path.join(__dirname, 'fixtures', 'names.json');
const fixtures = !argv.includes('--synth') && fs.existsSync(FIX) ? JSON.parse(fs.readFileSync(FIX, 'utf8')) : null;

// 글자 모양 대신 쓰는 테스트용 모양 (글자마다 모서리 깎은 상자)
function synthShape(len, rnd) {
  const chars = [];
  let x = 0;
  for (let i = 0; i < len; i++) { const cw = rnd() < 0.8 ? 1.0 : 0.62; chars.push([x, cw]); x += cw + 0.02; }
  const total = x - 0.02, h = 1.08, polys = [];
  for (const [x0, cw] of chars) {
    const l = x0 - total / 2, r = l + cw, t = -h / 2, b = h / 2, ch = 0.14;
    polys.push([[l + ch, t], [r - ch, t], [r, t + ch], [r, b - ch], [r - ch, b], [l + ch, b], [l, b - ch], [l, t + ch]]);
  }
  return { polys, w: total, h };
}
function pickPlayers(rnd) {
  if (!PLAYERS) return 2 + Math.floor(rnd() * 19);
  const [a, b] = String(PLAYERS).split('-').map(Number);
  return b ? a + Math.floor(rnd() * (b - a + 1)) : a;
}

const times = [], fails = [], perGame = [];
let sudden = 0, rush = 0, finalG = 0, unstick = [0, 0, 0, 0, 0, 0, 0], obsPlaced = 0, obsTried = 0, obsBroken = 0, steps = 0;
let corrSum = 0, corrN = 0, gamesWithTeleport = 0, maxStepMs = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const rnd = Sim.makeRng(SEED0 * 7919 + g);
  const nP = pickPlayers(rnd);
  const nS = Math.min(Sim.C.MAX_SEGMENTS, nP + (EXTRA !== null ? +EXTRA : Math.floor(rnd() * 3)));
  const labels = Array.from({ length: nS }, (_, i) => 'L' + i);
  const names = [];
  const pool = fixtures ? fixtures.slice() : null;
  for (let i = 0; i < nP; i++) {
    let s;
    if (pool) s = pool.splice(Math.floor(rnd() * pool.length), 1)[0] || fixtures[Math.floor(rnd() * fixtures.length)];
    else s = synthShape(2 + Math.floor(rnd() * 3), rnd);
    names.push({ id: 'p' + i, polys: s.polys, w: s.w, h: s.h, x: CROWD ? 15 : s.w / 2 + 0.4 + rnd() * (30 - s.w - 0.8) });
  }
  const obstacles = [];
  const kinds = MODE === 'block' ? ['block', 'block', 'tramp'] : ['block', 'tramp', 'bumper'];
  for (let i = 0; i < nP; i++) {
    for (let k = 0; k < OBS_PER; k++) {
      obsTried++;
      for (let tries = 0; tries < 40; tries++) {
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        let a;
        if (MODE === 'block') a = kind === 'tramp' ? 0 : (rnd() < 0.5 ? 1 : 11) * Math.PI / 12; // 가장 납작하게
        else a = kind === 'tramp' ? (Math.floor(rnd() * 7) - 3) * Math.PI / 12 : (1 + Math.floor(rnd() * 11)) * Math.PI / 12;
        const o = { id: `o${i}_${k}`, owner: 'p' + i, kind, x: 1 + rnd() * 28, y: 4 + rnd() * 25, a: Sim.normAngle(kind, a) };
        if (Sim.validateObstacle(map, obstacles, o).ok) { obstacles.push(o); obsPlaced++; break; }
      }
    }
  }
  const game = new Sim.Game({ seed: 77 + g * 13, map, labels, names, obstacles });
  let sd = false, rs = false, fn = false, tp = false, confirms = 0, ended = 0, nUnstick = 0, nStall = 0, gameMs = 0, gameMax = 0, gameSteps = 0, slowSteps = 0;
  while (!game.over && game.t < 200) {
    const s0 = process.hrtime.bigint();
    game.step(); steps++; gameSteps++;
    const ms = Number(process.hrtime.bigint() - s0) / 1e6;
    gameMs += ms;
    if (ms > 1000 / 120) slowSteps++;
    if (ms > gameMax) gameMax = ms;
    if (ms > maxStepMs) maxStepMs = ms;
    for (const e of game.drainEvents()) {
      if (e.t === 'confirm') confirms++;
      if (e.t === 'end') ended++;
      if (e.t === 'sudden') sd = true;
      if (e.t === 'rush') rs = true;
      if (e.t === 'final') fn = true;
      if (e.t === 'unstick') {
        unstick[Math.min(6, e.level)]++;
        if (e.level >= 3 && e.level < 9) tp = true;
        if (e.level === 9) nStall++; else nUnstick++;
      }
      if (e.t === 'break') obsBroken++;
    }
  }
  // 검증: 전원 확정, 칸 중복 없음
  const segs = game.results.map(r => r.seg);
  const uniq = new Set(segs);
  // 화면은 이벤트로만 결과를 알기 때문에 confirm/end 이벤트도 결과와 맞아야 한다
  const ok = game.over && game.results.length === nP && uniq.size === nP && !segs.includes(-1) && confirms === nP && ended === 1;
  if (!ok) fails.push({ g, nP, nS, done: game.results.length, over: game.over, t: game.t.toFixed(1), dup: segs.length - uniq.size, confirms, ended });
  times.push(game.t);
  perGame.push({
    g, nP, nS, nObs: obstacles.length, t: +game.t.toFixed(2), sudden: sd, rush: rs, final: fn, teleport: tp, unstick: nUnstick, stall: nStall, fail: !ok,
    msPerStep: +(gameMs / gameSteps).toFixed(3), maxStepMs: +gameMax.toFixed(1), slowStepPct: +(100 * slowSteps / gameSteps).toFixed(2),
  });
  if (process.env.VERBOSE) console.log(JSON.stringify(perGame[perGame.length - 1]));
  if (sd) sudden++;
  if (rs) rush++;
  if (fn) finalG++;
  if (tp) gamesWithTeleport++;
  // 출발 x와 통과 x의 상관 (보드가 너무 뻔한지 확인용)
  const xs = game.results.map(r => names.find(n => n.id === r.id).x), cx = game.results.map(r => r.x);
  if (xs.length > 3) {
    const m = a => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = m(xs), my = m(cx);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (cx[i] - my); sxx += (xs[i] - mx) ** 2; syy += (cx[i] - my) ** 2; }
    if (sxx > 0 && syy > 0) { corrSum += sxy / Math.sqrt(sxx * syy); corrN++; }
  }
}
const el = (Date.now() - t0) / 1000;
times.sort((a, b) => a - b);
const pct = p => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(1);
console.log(`course=${map.id}  shapes=${fixtures ? 'fixtures(' + fixtures.length + ')' : 'synthetic'}  players=${PLAYERS || '2-20'}  obs/person=${OBS_PER}  mode=${MODE}${CROWD ? '  crowd' : ''}`);
console.log(`games=${N}  fails=${fails.length}  elapsed=${el.toFixed(1)}s  ms/step=${(el * 1000 / steps).toFixed(3)}  max step=${maxStepMs.toFixed(1)}ms`);
console.log(`time  p10=${pct(0.1)} p50=${pct(0.5)} p90=${pct(0.9)} max=${times[times.length - 1].toFixed(1)}`);
console.log(`sudden=${sudden}  rush=${rush}  final(ghost)=${finalG}  games with teleport=${gamesWithTeleport}  unstick by level=${JSON.stringify(unstick.slice(1))}`);
console.log(`obstacles placed ${obsPlaced}/${obsTried}  broken=${obsBroken}  start→finish x corr=${(corrSum / Math.max(1, corrN)).toFixed(2)}`);
if (fails.length) console.log('FAILS', JSON.stringify(fails.slice(0, 10)));
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({
    course: map.id, shapes: fixtures ? 'fixtures' : 'synthetic', players: PLAYERS || '2-20', obsPer: OBS_PER, mode: MODE + (CROWD ? '+crowd' : ''), games: N, seed: SEED0,
    fails: fails.length, failList: fails, sudden, rush, final: finalG, gamesWithTeleport, unstick: unstick.slice(1),
    time: { p10: +pct(0.1), p50: +pct(0.5), p90: +pct(0.9), max: times[times.length - 1] },
    msPerStep: el * 1000 / steps, maxStepMs, obsPlaced, obsTried, obsBroken, corr: corrSum / Math.max(1, corrN),
    perGame,
  }));
}
process.exitCode = fails.length ? 1 : 0;
