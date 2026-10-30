/* 핀볼 사다리 — 물리 코어
 * 브라우저와 Node 양쪽에서 똑같이 돈다 (DOM 의존 없음).
 * 좌표계: 1단위 = 1m, y는 아래로 갈수록 커짐(화면 좌표와 동일).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('planck'));
  else root.Sim = factory(root.planck);
})(typeof self !== 'undefined' ? self : this, function (planck) {
  'use strict';

  const C = {
    W: 30,                 // 보드 폭
    START_Y: 0.4,          // 출발선(첫 줄) 이름 중심 y
    TIER_DY: 1.4,          // 출발 위치가 겹칠 때 위로 쌓는 간격
    MAX_TIER: 9,           // 이보다 높이 쌓이면(천장 y=-16 근처) 옆 빈자리로 비킨다
    FINISH_Y: 31,          // 레이저 결승선 y
    LABEL_BAND: 2.4,       // 결승선 아래 칸 이름 영역 높이
    VIEW: { x0: -0.6, y0: -3.2, x1: 30.6, y1: 34.0 },
    ZONE: { y0: 3.8, y1: 29.0 },  // 유저 장애물 설치 가능 높이
    CLEAR_MAP: 1.4,        // 유저 장애물 ↔ 맵 구조물 최소 간격
    CLEAR_OBS: 1.5,        // 유저 장애물끼리 최소 간격
    CLEAR_WALL: 1.5,       // 유저 장애물 ↔ 옆벽 최소 간격
    NAME_FONT: 1.0,        // 이름 글자 높이(m)
    NAME_MIN_FONT: 0.6,
    NAME_MAX_W: 4.6,       // 이름 최대 폭(m) — 넘으면 글자를 줄임
    NAME_MAX_CHARS: 8,
    NAME_MASS: 1.0,        // 모든 이름의 질량을 같게 맞춤
    GRAVITY: 8,
    DT: 1 / 120,
    HIT_SPEED: 1.4,        // 벽돌: 이 속도 이상으로 부딪혀야 1타
    HIT_COOLDOWN: 0.45,    // 같은 이름이 같은 장애물을 연속으로 깎지 못하게
    TRAMP_SPEED: 12.5,
    BUMP_SPEED: 9,
    MAP_BUMP_SPEED: 7.5,
    STUCK_WINDOW: 2.0,     // 이 시간 동안
    STUCK_DIST: 0.4,       // 이만큼도 못 움직이면 '끼임'
    T_SUDDEN: 45,          // 서든데스: 유저 장애물 전부 파괴 + 중력 증가
    T_FINAL: 75,           // 최종 보험: 남은 이름은 유령이 되어 모든 걸 통과
    MAX_PLAYERS: 30,
    MAX_SEGMENTS: 30,
  };

  const OBS = {
    block:  { label: '벽돌',     shape: 'box',    len: 2.4, th: 0.5, hp: 3 },
    tramp:  { label: '트램펄린', shape: 'box',    len: 2.6, th: 0.3, hp: 3 },
    bumper: { label: '범퍼',     shape: 'circle', r: 0.65,           hp: 3 },
  };

  // ---------- 난수 ----------
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 코스 ----------
  // short: 처음 만든 31m 코스(약 20초). long: 같은 1구간 아래로 다섯 구간을 더 이은 긴 코스.
  // 1구간(유저 장애물 구역)은 두 코스가 똑같아서, 폰의 장애물 검증·화면은 코스와 상관없다.
  // timers — sudden: 유저 장애물 전부 파괴(사용자 요구사항 45초), rush: 중력 1.6배, final: 남은 이름 유령 낙하.
  const COURSES = {
    short: { id: 'short', label: '짧은 코스', finishY: 31, timers: { sudden: 45, rush: 45, final: 75 } },
    long: { id: 'long', label: '긴 코스', finishY: 136, timers: { sudden: 45, rush: 90, final: 120 } },
  };
  const STAGES_LONG = [
    { name: '핀볼 숲', y0: -16, y1: 31.5 },
    { name: '지그재그 슬로프', y0: 31.5, y1: 65.5 },
    { name: '범퍼 정원', y0: 65.5, y1: 88 },
    { name: '시계추 골짜기', y0: 88, y1: 110 },
    { name: '회전 원판', y0: 110, y1: 123.5 },
    { name: '레이저 커튼', y0: 123.5, y1: Infinity },
  ];

  // ---------- 맵 ----------
  function buildMap(course) {
    const id = COURSES[course] ? course : 'short';
    const W = C.W, F = COURSES[id].finishY, els = [];
    const wall = (a, b, r) => els.push({ kind: 'wall', a, b, r: r || 0.3 });
    const pin = (x, y, r) => els.push({ kind: 'pin', c: [x, y], r: r || 0.3 });
    const bumper = (x, y, r) => els.push({ kind: 'bumper', c: [x, y], r });
    const mill = (x, y, len, speed) => els.push({ kind: 'mill', c: [x, y], len, thick: 0.36, speed });
    const defl = (a, b, r) => els.push({ kind: 'deflector', a, b, r: r || 0.22 });
    const pendulum = (x, y, len, amp, period, phase) => els.push({ kind: 'pendulum', c: [x, y], len, thick: 0.55, amp, period, phase: phase || 0 });
    const slider = (x, y, len, tilt, amp, period, phase) => els.push({ kind: 'slider', c: [x, y], len, thick: 0.45, tilt, amp, period, phase: phase || 0 });
    const disc = (x, y, r, speed) => els.push({ kind: 'disc', c: [x, y], r, speed });

    wall([0, -16], [0, F + 6]);
    wall([W, -16], [W, F + 6]);
    wall([0, -16], [W, -16]);
    wall([0, F + 5], [W, F + 5]);

    // 1구역: 엇갈린 핀 (핀 간격 > 가장 긴 이름 폭)
    [6, 12, 18, 24].forEach(x => pin(x, 5.0));
    [3, 9, 15, 21, 27].forEach(x => pin(x, 8.0));
    [6, 12, 18, 24].forEach(x => pin(x, 11.0));
    // 2구역: 풍차 두 개 + 범퍼
    mill(8.5, 15.0, 3.0, 1.7);
    mill(21.5, 15.0, 3.0, -1.7);
    bumper(15, 16.2, 0.85);
    // 옆벽에 붙어 미끄러지는 이름을 안쪽으로 밀어내는 짧은 턱
    defl([0, 12.6], [2.2, 13.8]);
    defl([W, 12.6], [W - 2.2, 13.8]);
    // 3구역: 옆벽 경사판 + 핀
    defl([0, 18.4], [4.8, 20.6]);
    defl([W, 18.4], [W - 4.8, 20.6]);
    [10.5, 19.5].forEach(x => pin(x, 20.4));
    pin(15, 21.6);
    [5.5, 24.5].forEach(x => pin(x, 23.4));
    // 4구역: 큰 풍차 + 핀
    mill(15, 26.4, 3.3, 1.15);
    pin(5.5, 27.0);
    pin(24.5, 27.0);

    if (id === 'long') {
      // 이름은 최대 4.6m 길이의 막대라서 구슬보다 길이 넓어야 한다: 통로·틈은 6m 이상, 경사는 20° 안팎,
      // 움직이는 부품은 벽에서 6m 이상 떨어뜨려(벽에 눌려 끼지 않게) 둔다.
      // 2구간: 지그재그 슬로프 — 27° 긴 경사판 둘. 끝에는 9.5m 틈.
      // 앞 경사판에서 날아온 이름이 벽에 맞고 다음 경사판 꼭대기 구석에 쌓이면 미끄러지는 이름과 맞부딪혀 막힌다
      // → 구석을 가파른 모서리판(50°)으로 메워서, 벽에 맞고 떨어진 이름도 미끄러지는 방향으로 출발하게 한다.
      defl([0, 34.5], [20.5, 44.9], 0.3);
      defl([W, 49.5], [W - 20.5, 59.9], 0.3);
      defl([W, 47.3], [W - 2.9, 50.95], 0.3);
      // 3구간: 범퍼 정원 — 엇갈린 범퍼 네 줄, 벽 쪽 턱
      [7, 15, 23].forEach(x => bumper(x, 69, 0.9));
      [11, 19].forEach(x => bumper(x, 74.5, 0.9));
      [7, 15, 23].forEach(x => bumper(x, 80, 0.9));
      [11, 19].forEach(x => bumper(x, 85.5, 0.9));
      defl([0, 71.5], [2.6, 73.0]);
      defl([W, 71.5], [W - 2.6, 73.0]);
      defl([0, 82.5], [2.6, 84.0]);
      defl([W, 82.5], [W - 2.6, 84.0]);
      // 4구간: 시계추 골짜기 — 가운데 큰 시계추, 아래로 좌우로 오가는 기울어진 발판 둘
      pin(15, 89.5, 0.6);
      pendulum(15, 89.5, 9.0, 0.62, 3.6, 0);
      slider(15, 103, 6.5, 0.26, 5.5, 4.2, 0);
      slider(15, 107.5, 6.5, -0.26, 5.5, 4.2, Math.PI);
      // 5구간: 회전 원판 — 반대로 도는 원판 둘 + 가운데 범퍼
      disc(8.5, 113.5, 2.4, 2.4);
      disc(W - 8.5, 113.5, 2.4, -2.4);
      bumper(15, 120, 1.1);
      defl([0, 116.5], [2.8, 118.0]);
      defl([W, 116.5], [W - 2.8, 118.0]);
      // 6구간: 레이저 커튼 — 벽에서 밀어내는 경사판 + 마지막 핀 (1구간 아래쪽과 같은 배치)
      defl([0, 124.5], [4.8, 126.7]);
      defl([W, 124.5], [W - 4.8, 126.7]);
      [10.5, 19.5].forEach(x => pin(x, 127.5));
      pin(15, 128.7);
      [5.5, 24.5].forEach(x => pin(x, 130.5));
      [9, 15, 21].forEach(x => pin(x, 133.0));
    }
    const stages = id === 'long' ? STAGES_LONG.map(s => Object.assign({}, s, { y1: Math.min(s.y1, F + 6) }))
      : [{ name: '핀볼 숲', y0: -16, y1: F + 6 }];
    return { id, W, F, els, stages, timers: COURSES[id].timers, view: { x0: -0.6, y0: -3.2, x1: W + 0.6, y1: F + 3 } };
  }

  // 움직이는 맵 요소의 시각 t 자세 (물리와 대기실 그림이 같이 쓴다, 결정적)
  function moverPose(el, t) {
    const w = el.period ? 2 * Math.PI / el.period : 0;
    if (el.kind === 'pendulum') return { x: el.c[0], y: el.c[1], a: el.amp * Math.sin(w * t + el.phase) };
    if (el.kind === 'slider') return { x: el.c[0] + el.amp * Math.sin(w * t + el.phase), y: el.c[1], a: el.tilt };
    return { x: el.c[0], y: el.c[1], a: (el.speed || 0) * t };
  }
  function stageAt(map, y) {
    const i = map.stages.findIndex(s => y < s.y1);
    return i < 0 ? map.stages.length - 1 : i;
  }

  // ---------- 기하 ----------
  function segPt(a, b, p) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
    let t = L ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + vx * t - p[0], y = a[1] + vy * t - p[1];
    return Math.sqrt(x * x + y * y);
  }
  function orient(p, q, r) { return Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); }
  function segSeg(a, b, c, d) {
    if (orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b)) return 0;
    return Math.min(segPt(a, b, c), segPt(a, b, d), segPt(c, d, a), segPt(c, d, b));
  }
  function geomOf(el) {
    if (el.kind === 'pin' || el.kind === 'bumper' || el.kind === 'disc') return { t: 'cir', c: el.c, r: el.r };
    if (el.kind === 'mill') return { t: 'cir', c: el.c, r: el.len + el.thick };
    if (el.kind === 'pendulum') return { t: 'cir', c: el.c, r: el.len + el.thick };
    if (el.kind === 'slider') return { t: 'cap', a: [el.c[0] - el.amp, el.c[1]], b: [el.c[0] + el.amp, el.c[1]], r: el.len / 2 + el.thick };
    return { t: 'cap', a: el.a, b: el.b, r: el.r };
  }
  function obsGeom(o) {
    const def = OBS[o.kind];
    if (def.shape === 'circle') return { t: 'cir', c: [o.x, o.y], r: def.r };
    const hx = def.len / 2, ca = Math.cos(o.a), sa = Math.sin(o.a);
    return { t: 'cap', a: [o.x - ca * hx, o.y - sa * hx], b: [o.x + ca * hx, o.y + sa * hx], r: def.th / 2 };
  }
  function gDist(g1, g2) {
    if (g1.t === 'cir' && g2.t === 'cir') return Math.hypot(g1.c[0] - g2.c[0], g1.c[1] - g2.c[1]) - g1.r - g2.r;
    if (g1.t === 'cir') return segPt(g2.a, g2.b, g1.c) - g1.r - g2.r;
    if (g2.t === 'cir') return segPt(g1.a, g1.b, g2.c) - g1.r - g2.r;
    return segSeg(g1.a, g1.b, g2.a, g2.b) - g1.r - g2.r;
  }
  function geomExtent(g) {
    if (g.t === 'cir') return [g.c[0] - g.r, g.c[1] - g.r, g.c[0] + g.r, g.c[1] + g.r];
    return [Math.min(g.a[0], g.b[0]) - g.r, Math.min(g.a[1], g.b[1]) - g.r,
            Math.max(g.a[0], g.b[0]) + g.r, Math.max(g.a[1], g.b[1]) + g.r];
  }

  // 장애물 각도 정리: 상자는 180° 대칭, 트램펄린은 윗면이 위를 보도록
  function normAngle(kind, a) {
    if (kind === 'bumper') return 0;
    let x = a % Math.PI; if (x < 0) x += Math.PI;           // [0, π)
    if (kind === 'tramp' && x >= Math.PI / 2) x -= Math.PI;  // [-π/2, π/2)
    return x;
  }

  function validateObstacle(map, list, o) {
    const def = o && OBS[o.kind];
    if (!def || ![o.x, o.y, o.a].every(Number.isFinite)) return { ok: false, reason: '잘못된 장애물이에요' };
    const g = obsGeom(o), ext = geomExtent(g);
    if (ext[1] < C.ZONE.y0 || ext[3] > C.ZONE.y1) return { ok: false, reason: '점선 안(설치 구역)에 놓아주세요' };
    if (ext[0] < C.CLEAR_WALL || ext[2] > map.W - C.CLEAR_WALL) return { ok: false, reason: '벽과 너무 가까워요' };
    if (o.kind === 'block' && Math.abs(Math.sin(o.a)) < Math.sin(14 * Math.PI / 180))
      return { ok: false, reason: '벽돌은 15° 이상 기울여야 해요 (위에 얹혀 멈추는 걸 막기 위해)' };
    if (o.kind === 'tramp' && Math.abs(Math.sin(o.a)) > Math.sin(46 * Math.PI / 180))
      return { ok: false, reason: '트램펄린은 45°까지만 기울일 수 있어요' };
    for (const el of map.els) {
      if (el.kind === 'wall') continue;
      if (gDist(g, geomOf(el)) < C.CLEAR_MAP) return { ok: false, reason: '맵 구조물과 너무 가까워요' };
    }
    for (const other of list) {
      if (other.id === o.id) continue;
      if (gDist(g, obsGeom(other)) < C.CLEAR_OBS) return { ok: false, reason: '다른 장애물과 너무 가까워요' };
    }
    return { ok: true };
  }

  // ---------- 다각형 ----------
  function polyArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }
  function simplifyConvex(h, maxV) {
    const p = h.slice();
    const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    while (p.length > maxV) {
      let bi = 0, ba = Infinity;
      for (let i = 0; i < p.length; i++) {
        const a = tri(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]);
        if (a < ba) { ba = a; bi = i; }
      }
      p.splice(bi, 1);
    }
    return p;
  }
  // 물리 엔진에 넣어도 안전한 볼록 다각형으로 정리 (꼭짓점 8개 이하)
  function cleanPoly(pts, maxV) {
    let h = convexHull(pts);
    const out = [];
    for (const q of h) { const last = out[out.length - 1]; if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.03) out.push(q); }
    if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.03) out.pop();
    h = simplifyConvex(out, maxV || 8);
    if (h.length < 3 || polyArea(h) < 0.01) return null;
    return h;
  }

  // ---------- 출발 배치 ----------
  function clampDropX(x, w) {
    const half = (w || 1) / 2;
    return Math.max(half + 0.4, Math.min(C.W - half - 0.4, Number.isFinite(x) ? x : C.W / 2));
  }
  // 같은 위치를 고른 사람끼리는 위로 쌓아서 겹치지 않게.
  // 30명이 한 곳에 몰리면 천장 위까지 쌓이므로 MAX_TIER를 넘으면 가장 가까운 빈자리로 옆으로 비킨다.
  function layoutStart(entries) {
    const placed = [], out = {};
    const free = (x, half, tier) => !placed.some(p => p.tier === tier && Math.abs(p.x - x) < p.half + half + 0.25);
    for (const e of entries) {
      const half = e.w / 2;
      let x = clampDropX(e.x, e.w), tier = 0;
      while (!free(x, half, tier)) tier++;
      if (tier > C.MAX_TIER) {
        let best = null;
        for (let d = 0.25; d <= C.W && !best; d += 0.25) {
          for (const s of [-1, 1]) {
            const nx = clampDropX(x + s * d, e.w);
            for (let t = 0; t <= C.MAX_TIER && !best; t++) if (free(nx, half, t)) best = { x: nx, tier: t };
            if (best) break;
          }
        }
        if (best) { x = best.x; tier = best.tier; }
      }
      placed.push({ x, half, tier });
      out[e.id] = { x, y: C.START_Y - tier * C.TIER_DY, tier };
    }
    return out;
  }

  // ---------- 레이저 결승선의 칸 ----------
  // 이름이 통과하면 그 칸이 확정되고, 양쪽 경계선이 하나로 합쳐지며 칸이 사라진다.
  // 남은 칸이 항상 바닥 전체를 덮기 때문에 한 칸에 두 명이 들어갈 수 없다.
  class Segments {
    constructor(labels, W) {
      this.W = W;
      const w = W / Math.max(1, labels.length);
      this.list = labels.map((label, i) => ({ i, label, w, target: w, owner: null, closed: false, closedAt: 0 }));
    }
    bounds() { let x = 0; return this.list.map(s => { const a = x; x += s.w; return [a, x]; }); }
    openCount() { let n = 0; for (const s of this.list) if (!s.closed) n++; return n; }
    _neighbor(k, dir) {
      for (let j = k + dir; j >= 0 && j < this.list.length; j += dir) if (!this.list[j].closed) return j;
      return -1;
    }
    locate(x) {
      const b = this.bounds();
      let k = b.findIndex(([a, c]) => x >= a && x < c);
      if (k < 0) k = x < 0 ? 0 : this.list.length - 1;
      if (k >= 0 && this.list[k] && this.list[k].closed) {
        // 이미 확정돼 줄어드는 중인 칸 → 더 가까운 열린 칸으로
        let best = -1, bd = Infinity;
        this.list.forEach((s, j) => {
          if (s.closed) return;
          const [a, c] = b[j], d = x < a ? a - x : x > c ? x - c : 0;
          if (d < bd) { bd = d; best = j; }
        });
        k = best;
      }
      return k;
    }
    assign(x, owner, t) {
      const k = this.locate(x);
      if (k < 0) return null;
      const s = this.list[k];
      s.closed = true; s.owner = owner; s.closedAt = t || 0;
      const L = this._neighbor(k, -1), R = this._neighbor(k, 1), amt = s.target;
      s.target = 0;
      if (L >= 0 && R >= 0) { this.list[L].target += amt / 2; this.list[R].target += amt / 2; }
      else if (L >= 0) this.list[L].target += amt;
      else if (R >= 0) this.list[R].target += amt;
      return s;
    }
    update(dt) {
      const k = 1 - Math.exp(-dt * 4.5);
      for (const s of this.list) s.w += (s.target - s.w) * k;
    }
  }

  // ---------- 게임 ----------
  class Game {
    /* opts: { seed, map, labels[], names[{id, polys, w, h, x}], obstacles[{id, owner, kind, x, y, a}] } */
    constructor(opts) {
      this.map = opts.map || buildMap();
      this.rand = makeRng(opts.seed || 1);
      this.t = 0;
      this.events = [];
      this.over = false;
      this.world = new planck.World({ gravity: { x: 0, y: C.GRAVITY } });
      this.F = this.map.F || C.FINISH_Y;
      this.timers = this.map.timers || { sudden: C.T_SUDDEN, rush: C.T_SUDDEN, final: C.T_FINAL };
      this.segments = new Segments(opts.labels, C.W);
      this.mills = [];
      this.movers = [];   // 시계추·발판·원판 (운동학 바디)
      this._buildStatics();
      this.obs = new Map();
      (opts.obstacles || []).forEach(o => this._addObstacle(o));
      this.names = new Map();
      const starts = layoutStart(opts.names);
      opts.names.forEach((n, i) => this._addName(n, starts[n.id], i));
      this.remaining = this.names.size;
      this.results = [];
      this.hits = [];
      this.nextSample = 0;
      this.suddenDone = false;
      this.rushDone = false;
      this.finalDone = false;
      this.world.on('begin-contact', c => this._onBegin(c));
      this.world.on('pre-solve', c => this._onPreSolve(c));
      if (this.remaining === 0) this.over = true;
    }

    _buildStatics() {
      const ground = this.world.createBody({ type: 'static' });
      for (const el of this.map.els) {
        if (el.kind === 'wall' || el.kind === 'deflector') {
          const [ax, ay] = el.a, [bx, by] = el.b;
          const len = Math.hypot(bx - ax, by - ay);
          ground.createFixture(new planck.Box(len / 2, el.r, { x: (ax + bx) / 2, y: (ay + by) / 2 }, Math.atan2(by - ay, bx - ax)),
            { friction: 0.15, restitution: 0.2, userData: { type: el.kind } });
        } else if (el.kind === 'pin') {
          ground.createFixture(new planck.Circle({ x: el.c[0], y: el.c[1] }, el.r), { friction: 0.1, restitution: 0.45, userData: { type: 'pin' } });
        } else if (el.kind === 'bumper') {
          ground.createFixture(new planck.Circle({ x: el.c[0], y: el.c[1] }, el.r), { friction: 0.05, restitution: 0.6, userData: { type: 'mbumper', c: el.c } });
        } else if (el.kind === 'mill') {
          const b = this.world.createBody({ type: 'kinematic', position: { x: el.c[0], y: el.c[1] }, angle: this.rand() * Math.PI });
          b.createFixture(new planck.Box(el.len, el.thick / 2), { friction: 0.2, restitution: 0.35, userData: { type: 'mill' } });
          b.createFixture(new planck.Box(el.thick / 2, el.len), { friction: 0.2, restitution: 0.35, userData: { type: 'mill' } });
          b.setAngularVelocity(el.speed);
          this.mills.push({ el, body: b });
        } else if (el.kind === 'pendulum' || el.kind === 'slider' || el.kind === 'disc') {
          const p = moverPose(el, 0);
          const b = this.world.createBody({ type: 'kinematic', position: { x: p.x, y: p.y }, angle: p.a });
          if (el.kind === 'pendulum') {
            // 회전축(바디 원점)에서 아래로 매달린 막대
            b.createFixture(new planck.Box(el.thick / 2, el.len / 2, { x: 0, y: el.len / 2 }, 0), { friction: 0.2, restitution: 0.35, userData: { type: 'mover' } });
          } else if (el.kind === 'slider') {
            b.createFixture(new planck.Box(el.len / 2, el.thick / 2), { friction: 0.25, restitution: 0.2, userData: { type: 'mover' } });
          } else {
            b.createFixture(new planck.Circle(el.r), { friction: 0.6, restitution: 0.25, userData: { type: 'disc' } });
            b.setAngularVelocity(el.speed);
          }
          this.movers.push({ el, body: b });
        }
      }
    }

    _addObstacle(o) {
      const def = OBS[o.kind];
      if (!def) return;
      const a = def.shape === 'circle' ? 0 : (o.a || 0);
      const body = this.world.createBody({ type: 'static', position: { x: o.x, y: o.y }, angle: a });
      const shape = def.shape === 'circle' ? new planck.Circle(def.r) : new planck.Box(def.len / 2, def.th / 2);
      body.createFixture(shape, {
        friction: o.kind === 'tramp' ? 0.5 : 0.2,
        restitution: o.kind === 'bumper' ? 0.5 : 0.2,
        userData: { type: 'uobs', id: o.id },
      });
      this.obs.set(o.id, { id: o.id, owner: o.owner, kind: o.kind, x: o.x, y: o.y, a, def, body, hp: def.hp, alive: true, lastHit: new Map(), flash: 0 });
    }

    _addName(n, start, order) {
      const jitter = (this.rand() - 0.5) * 0.06;
      const body = this.world.createBody({
        type: 'dynamic', position: { x: start.x + jitter, y: start.y }, angle: 0,
        bullet: true, allowSleep: false, linearDamping: 0.08, angularDamping: 0.08,
      });
      const polys = (n.polys || []).map(p => cleanPoly(p, 8)).filter(Boolean);
      let area = 0;
      for (const p of polys) area += polyArea(p);
      const density = C.NAME_MASS / Math.max(area, 0.05);
      for (const p of polys) {
        body.createFixture(new planck.Polygon(p.map(v => ({ x: v[0], y: v[1] }))),
          { density, friction: 0.22, restitution: 0.3, userData: { type: 'name', id: n.id } });
      }
      if (!body.getFixtureList()) {
        const hw = Math.max(0.3, (n.w || 1) / 2), hh = Math.max(0.3, (n.h || 1) / 2);
        body.createFixture(new planck.Box(hw, hh), { density: C.NAME_MASS / (4 * hw * hh), friction: 0.22, restitution: 0.3, userData: { type: 'name', id: n.id } });
      }
      body.setAngularVelocity((this.rand() - 0.5) * 0.5);
      const c = body.getWorldCenter();
      this.names.set(n.id, {
        id: n.id, order, body, w: n.w || 1, h: n.h || 1, done: false,
        prevX: c.x, prevY: c.y, hist: [], stuckLevel: 0, lastUnstick: -99,
        bestY: c.y, bestYAt: 0, stalls: 0, phaseUntil: 0,
        ghostUntil: 0, noCollide: false, lastMapKick: -9, result: null, exit: null,
      });
    }

    _pair(c) {
      const fa = c.getFixtureA(), fb = c.getFixtureB();
      const ua = fa.getUserData() || {}, ub = fb.getUserData() || {};
      if (ua.type === 'name' && ub.type === 'name') return { both: true, ua, ub };
      if (ua.type === 'name') return { nf: fa, of: fb, nu: ua, ou: ub, nameIsA: true };
      if (ub.type === 'name') return { nf: fb, of: fa, nu: ub, ou: ua, nameIsA: false };
      return null;
    }

    // 유령 상태: 모든 충돌을 무시 (최종 보험 또는 순환 함정 탈출용)
    _phasing(n) { return !!n && (n.noCollide || n.phaseUntil > this.t); }
    _trampUp(o) { return [Math.sin(o.a), -Math.cos(o.a)]; }
    _above(o, n) {
      if (!n.body) return false;
      const c = n.body.getWorldCenter(), u = this._trampUp(o);
      return (c.x - o.x) * u[0] + (c.y - o.y) * u[1] > 0.05;
    }

    _onPreSolve(c) {
      const p = this._pair(c);
      if (!p) return;
      if (p.both) {
        if (this._phasing(this.names.get(p.ua.id)) || this._phasing(this.names.get(p.ub.id))) c.setEnabled(false);
        return;
      }
      const n = this.names.get(p.nu.id);
      if (!n) return;
      if (this._phasing(n)) { c.setEnabled(false); return; }
      if (p.ou.type !== 'uobs') return;
      if (n.ghostUntil > this.t) { c.setEnabled(false); return; }
      const o = this.obs.get(p.ou.id);
      if (o && o.kind === 'tramp' && !this._above(o, n)) c.setEnabled(false); // 트램펄린은 아래에서 올라오면 통과
    }

    _onBegin(c) {
      const p = this._pair(c);
      if (!p || p.both) return;
      if (p.ou.type !== 'uobs' && p.ou.type !== 'mbumper') return;
      const n = this.names.get(p.nu.id);
      if (!n || n.done || this._phasing(n)) return;
      const nb = p.nf.getBody(), ob = p.of.getBody();
      const wm = c.getWorldManifold(null);
      const pt = (wm && wm.points && wm.points[0]) || nb.getWorldCenter();
      const vn = nb.getLinearVelocityFromWorldPoint(pt), vo = ob.getLinearVelocityFromWorldPoint(pt);
      let nx = wm ? wm.normal.x : 0, ny = wm ? wm.normal.y : 0;
      if (p.nameIsA) { nx = -nx; ny = -ny; }   // 장애물 → 이름 방향
      const approach = -((vn.x - vo.x) * nx + (vn.y - vo.y) * ny);
      this.hits.push({ nameId: n.id, ou: p.ou, approach, x: pt.x, y: pt.y });
    }

    _launch(n, dir, speed) {
      const v = n.body.getLinearVelocity(), vn = v.x * dir[0] + v.y * dir[1], add = speed - vn;
      if (add > 0) n.body.setLinearVelocity({ x: v.x + dir[0] * add, y: v.y + dir[1] * add });
    }
    _push(n, center, speed) {
      const c = n.body.getWorldCenter();
      const dx = c.x - center[0], dy = c.y - center[1], L = Math.hypot(dx, dy) || 1;
      this._launch(n, [dx / L, dy / L], speed);
    }
    _breakObs(o) {
      if (!o.alive) return;
      o.alive = false;
      this.world.destroyBody(o.body);
      o.body = null;
      o.brokenAt = this.t;
      this.events.push({ t: 'break', id: o.id, kind: o.kind, x: o.x, y: o.y });
    }

    // 충돌 콜백 안에서는 월드를 못 바꾸므로 스텝이 끝난 뒤 몰아서 처리
    _processHits() {
      for (const h of this.hits) {
        const n = this.names.get(h.nameId);
        if (!n || n.done || !n.body) continue;
        if (h.ou.type === 'mbumper') {
          if (this.t - n.lastMapKick < 0.15) continue;
          n.lastMapKick = this.t;
          this._push(n, h.ou.c, C.MAP_BUMP_SPEED);
          this.events.push({ t: 'kick', x: h.x, y: h.y });
          continue;
        }
        const o = this.obs.get(h.ou.id);
        if (!o || !o.alive) continue;
        const last = o.lastHit.has(n.id) ? o.lastHit.get(n.id) : -9;
        if (this.t - last < C.HIT_COOLDOWN) continue;
        if (o.kind === 'tramp') {
          if (!this._above(o, n)) continue;
          this._launch(n, this._trampUp(o), C.TRAMP_SPEED);
          this.events.push({ t: 'bounce', id: o.id, x: h.x, y: h.y });
        } else if (o.kind === 'bumper') {
          this._push(n, [o.x, o.y], C.BUMP_SPEED);
          this.events.push({ t: 'kick', id: o.id, x: h.x, y: h.y });
        } else {
          if (h.approach < C.HIT_SPEED) continue;
          this.events.push({ t: 'hit', id: o.id, x: h.x, y: h.y });
        }
        o.lastHit.set(n.id, this.t);
        o.hp -= 1;
        o.flash = 1;
        if (o.hp <= 0) this._breakObs(o);
      }
      this.hits.length = 0;
    }

    // 다음 스텝 시각의 자세에 정확히 닿도록 속도를 준다 (오차가 쌓이지 않음)
    _moveKinematics() {
      if (!this.movers.length) return;
      const t1 = this.t + C.DT;
      for (const m of this.movers) {
        if (m.el.kind === 'disc') continue;   // 원판은 일정한 각속도
        const p = moverPose(m.el, t1), b = m.body;
        if (m.el.kind === 'pendulum') b.setAngularVelocity((p.a - b.getAngle()) / C.DT);
        else { const q = b.getPosition(); b.setLinearVelocity({ x: (p.x - q.x) / C.DT, y: (p.y - q.y) / C.DT }); }
      }
    }

    _checkFinish() {
      const F = this.F, crossings = [];
      for (const n of this.names.values()) {
        if (n.done) continue;
        const c = n.body.getWorldCenter();
        if (n.prevY < F && c.y >= F) {
          const t = (F - n.prevY) / ((c.y - n.prevY) || 1);
          crossings.push({ n, t, x: n.prevX + (c.x - n.prevX) * t });
        }
        n.prevX = c.x; n.prevY = c.y;
      }
      // 같은 스텝에 여러 명이 통과하면 먼저 선을 넘은 순서대로
      crossings.sort((a, b) => a.t - b.t || a.n.order - b.n.order);
      for (const cr of crossings) {
        const n = cr.n;
        const seg = this.segments.assign(Math.max(0, Math.min(C.W - 1e-6, cr.x)), n.id, this.t);
        const pos = n.body.getPosition();
        n.exit = { x: pos.x, y: pos.y, a: n.body.getAngle(), t: this.t, cx: cr.x };
        n.done = true;
        n.result = seg ? seg.i : -1;
        this.world.destroyBody(n.body);
        n.body = null;
        this.remaining--;
        const r = { id: n.id, seg: seg ? seg.i : -1, label: seg ? seg.label : null, x: cr.x, t: this.t };
        this.results.push(r);
        this.events.push(Object.assign({}, r, { t: 'confirm', time: this.t }));   // r.t(시간)가 이벤트 종류를 덮지 않게
      }
      if (!this.over && (this.remaining === 0 || this.segments.openCount() === 0)) {
        this.over = true;
        this.events.push({ t: 'end' });
      }
    }

    _antiStuck() {
      if (this.t < this.nextSample) return;
      this.nextSample = this.t + 0.25;
      for (const n of this.names.values()) {
        if (n.done || this._phasing(n)) continue;
        const c = n.body.getWorldCenter();
        if (c.x < -0.5 || c.x > C.W + 0.5) {
          const b = n.body, p = b.getPosition(), half = Math.min(C.W / 2 - 0.5, n.w / 2 + 0.6);
          const nx = Math.max(half, Math.min(C.W - half, c.x));
          b.setTransform({ x: p.x + nx - c.x, y: p.y }, b.getAngle());
          b.setLinearVelocity({ x: 0, y: Math.max(1, b.getLinearVelocity().y) });
          n.prevX = nx;
          this.events.push({ t: 'unstick', id: n.id, level: 8, x: nx, y: c.y });
          continue;
        }
        // 순환 함정(풍차에 실려 돌기, 범퍼 사이 왕복 등): 7초 동안 더 내려가지 못하면 잠깐 유령으로 빠져나감
        if (c.y > n.bestY + 0.8) { n.bestY = c.y; n.bestYAt = this.t; }
        else if (this.t - n.bestYAt > 7) { this._unstall(n); n.bestYAt = this.t; n.hist.length = 0; continue; }
        n.hist.push([this.t, c.x, c.y]);
        while (n.hist.length && this.t - n.hist[0][0] > C.STUCK_WINDOW + 1e-6) n.hist.shift();
        if (this.t - n.lastUnstick < C.STUCK_WINDOW) continue;
        if (this.t - n.hist[0][0] < C.STUCK_WINDOW - 0.3) continue;
        const x0 = n.hist[0][1], y0 = n.hist[0][2];
        let maxD = 0;
        for (const h of n.hist) maxD = Math.max(maxD, Math.hypot(h[1] - x0, h[2] - y0));
        if (maxD < C.STUCK_DIST) {
          n.stuckLevel += 1;
          n.lastUnstick = this.t;
          this._unstick(n);
          n.hist.length = 0;
        } else if (maxD > 2.5) n.stuckLevel = 0;
      }
    }

    // 끼임 해결: 1단계 튕기기 → 2단계 유저 장애물 통과 + 튕기기 → 3단계 빈 곳으로 이동 → 5단계 유령
    _unstick(n) {
      const b = n.body, L = n.stuckLevel, dir = this.rand() < 0.5 ? -1 : 1;
      if (L >= 3) {
        const spot = this._freeSpot(n);
        if (spot) {
          const p = b.getPosition(), c = b.getWorldCenter();
          b.setTransform({ x: p.x + spot[0] - c.x, y: p.y + spot[1] - c.y }, b.getAngle());
        }
        n.ghostUntil = this.t + 2.0;
        b.setLinearVelocity({ x: dir * 1.5, y: 1 });
        b.setAngularVelocity((this.rand() - 0.5) * 2);
        const nc = b.getWorldCenter();
        n.prevX = nc.x; n.prevY = nc.y;
        if (L >= 5) n.noCollide = true;
      } else {
        if (L === 2) n.ghostUntil = this.t + 2.5;
        const s = L === 1 ? 1 : 1.4;
        b.setLinearVelocity({ x: dir * (2.5 + this.rand() * 2) * s, y: -(3 + this.rand() * 2) * s });
        b.setAngularVelocity((this.rand() - 0.5) * 7);
      }
      const c = b.getWorldCenter();
      this.events.push({ t: 'unstick', id: n.id, level: L, x: c.x, y: c.y });
    }

    _unstall(n) {
      const b = n.body, c = b.getWorldCenter();
      n.stalls += 1;
      n.phaseUntil = this.t + (n.stalls === 1 ? 0.9 : 1.6);
      const toCenter = c.x < C.W / 2 ? 1 : -1;
      b.setLinearVelocity({ x: toCenter * 1.5, y: 4.5 });
      b.setAngularVelocity(0);
      this.events.push({ t: 'unstick', id: n.id, level: 9, x: c.x, y: c.y });
    }

    _freeSpot(n) {
      const c = n.body.getWorldCenter();
      const hw = n.w / 2 + 0.15, hh = n.h / 2 + 0.15;
      for (const dy of [-1.8, -3.0, -1.0]) {
        for (const dx of [0, 1.6, -1.6, 3.2, -3.2]) {
          const x = Math.max(hw + 0.3, Math.min(C.W - hw - 0.3, c.x + dx)), y = Math.max(-1, c.y + dy);
          let free = true;
          this.world.queryAABB(new planck.AABB({ x: x - hw, y: y - hh }, { x: x + hw, y: y + hh }), f => {
            if (f.getBody() === n.body) return true;
            const ud = f.getUserData() || {};
            if (ud.type === 'wall') return true;
            free = false;
            return false;
          });
          if (free) return [x, y];
        }
      }
      return null;
    }

    _timeRules() {
      const tm = this.timers;
      if (!this.suddenDone && this.t >= tm.sudden) {
        this.suddenDone = true;
        let broke = 0, busy = false;
        for (const o of this.obs.values()) if (o.alive) { this._breakObs(o); broke++; }
        // 긴 코스에서는 보통 다들 이미 장애물 구역을 지나갔다 → 화면 알림은 구역에 이름이 남아 있을 때만
        for (const n of this.names.values()) if (!n.done && n.body && n.body.getWorldCenter().y < C.ZONE.y1 + 2) busy = true;
        this.events.push({ t: 'sudden', broke, busy });
      }
      if (!this.rushDone && this.t >= tm.rush) {
        this.rushDone = true;
        this.world.setGravity({ x: 0, y: C.GRAVITY * 1.6 });
        this.events.push({ t: 'rush' });
      }
      if (!this.finalDone && this.t >= tm.final) {
        this.finalDone = true;
        for (const n of this.names.values()) {
          if (n.done) continue;
          n.noCollide = true;
          const v = n.body.getLinearVelocity();
          n.body.setLinearVelocity({ x: v.x * 0.2, y: Math.max(3, v.y) });
        }
        this.events.push({ t: 'final' });
      }
    }

    step() {
      if (this.over) return;
      this._moveKinematics();
      this.world.step(C.DT, 8, 3);
      this.t += C.DT;
      this._processHits();
      this.segments.update(C.DT);
      this._checkFinish();
      if (this.over) return;
      this._antiStuck();
      this._timeRules();
      for (const o of this.obs.values()) if (o.flash > 0) o.flash = Math.max(0, o.flash - C.DT * 3);
    }

    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  return {
    C, OBS, COURSES, makeRng, buildMap, moverPose, stageAt, validateObstacle, normAngle, obsGeom, layoutStart, clampDropX,
    convexHull, simplifyConvex, cleanPoly, polyArea, Segments, Game,
  };
});
