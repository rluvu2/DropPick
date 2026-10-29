// 여러 프로세스로 headless.js를 나눠 돌려 많은 판을 빠르게 검증하고 결과를 합친다.
//   node test/stress.js [총 판 수] [옵션...]
//     --procs 12          동시에 돌릴 프로세스 수 (기본: CPU 수 - 2)
//     --seed 1000         시작 시드
//     나머지 옵션은 headless.js로 그대로 넘긴다 (--players 30 --extra 0 --obs 2 --mode random ...)
//     --out file.json     합친 결과 저장
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const total = +argv[0] || 1000;
const take = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const procs = +take('procs', Math.max(1, os.cpus().length - 2));
const seed0 = +take('seed', 1000);
const out = take('out', null);
const pass = argv.slice(1);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plb-stress-'));

const per = Math.ceil(total / procs);
const jobs = [];
const t0 = Date.now();
for (let i = 0; i < procs; i++) {
  const n = Math.min(per, total - i * per);
  if (n <= 0) break;
  const file = path.join(tmp, `part${i}.json`);
  jobs.push(new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, [path.join(__dirname, 'headless.js'), String(n), String(seed0 + i * 1009), ...pass, '--json', file], { stdio: ['ignore', 'ignore', 'inherit'] });
    cp.on('exit', () => { try { resolve(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { reject(e); } });
  }));
}

Promise.all(jobs).then(parts => {
  const games = parts.flatMap(p => p.perGame);
  const N = games.length;
  const count = f => games.filter(f).length;
  const times = games.map(g => g.t).sort((a, b) => a - b);
  const pct = p => times[Math.min(N - 1, Math.floor(N * p))];
  const fails = parts.flatMap(p => p.failList);
  const pc = (k, n) => (100 * k / Math.max(1, n)).toFixed(2) + '%';
  // 0건일 때 95% 신뢰 상한 ≈ 3/N (rule of three)
  const upper = k => k === 0 ? (100 * 3 / N).toFixed(2) + '% 미만 (95% 신뢰)' : '';
  const sum = {
    games: N, settings: { shapes: parts[0].shapes, players: parts[0].players, obsPer: parts[0].obsPer, mode: parts[0].mode },
    fails: fails.length, failRate: pc(fails.length, N), failUpper: upper(fails.length), failList: fails.slice(0, 20),
    sudden45: count(g => g.sudden), suddenRate: pc(count(g => g.sudden), N),
    final75: count(g => g.final), finalRate: pc(count(g => g.final), N),
    teleportGames: count(g => g.teleport), teleportRate: pc(count(g => g.teleport), N),
    stallGames: count(g => g.stall > 0), stallRate: pc(count(g => g.stall > 0), N),
    anyRescueGames: count(g => g.unstick > 0 || g.stall > 0), anyRescueRate: pc(count(g => g.unstick > 0 || g.stall > 0), N),
    unstickByLevel: parts.reduce((a, p) => a.map((v, i) => v + p.unstick[i]), [0, 0, 0, 0, 0, 0]),
    time: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: times[N - 1] },
    over45s: count(g => g.t > 45), over60s: count(g => g.t > 60),
    avgObstacles: +(games.reduce((s, g) => s + g.nObs, 0) / N).toFixed(1),
    msPerStep: +(parts.reduce((s, p) => s + p.msPerStep, 0) / parts.length).toFixed(3),
    maxStepMs: +Math.max(...parts.map(p => p.maxStepMs)).toFixed(1),
    wallSeconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
  console.log(JSON.stringify(Object.assign({}, sum, { failList: undefined }), null, 1));
  if (fails.length) console.log('FAILS', JSON.stringify(fails.slice(0, 20)));
  if (out) fs.writeFileSync(out, JSON.stringify(Object.assign(sum, { perGame: games }), null, 1));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = fails.length ? 1 : 0;
}).catch(e => { console.error(e); process.exit(1); });
