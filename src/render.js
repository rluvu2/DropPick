/* 핀볼 사다리 — 보드 렌더링 (호스트·폰 공용) + 이펙트 + 미니맵 + 사운드 + 에셋 */
(function (root) {
  'use strict';
  const Sim = root.Sim, C = Sim.C, OBS = Sim.OBS;

  const COL = {
    inkDeep: '#140F26', ink: '#1B1530', ink2: '#221A3E', ink3: '#2F2652', line: '#463B73',
    chrome: '#C9CEDD', text: '#F3EEFF', muted: '#A49CC4',
    laser: '#FF3B5C', amber: '#FFB547', teal: '#4FD1C5', magenta: '#E46BC4', brick: '#E86A5B',
    bad: '#FF6B7A', good: '#7DE38D',
  };
  // 이름 색 (레이저 빨강은 피함). 앞 16개가 기본, 뒤는 30명까지 겹치지 않게 보충
  const PALETTE = [
    '#FFB547', '#4FD1C5', '#FF7AA8', '#8FB8FF', '#B9F27C', '#FF8A5B', '#C79BFF', '#FFE066',
    '#5EE0FF', '#FF9EE5', '#7DE38D', '#FFC4A3', '#A0E7E5', '#F28BFF', '#9EC1FF', '#FFD1F0',
    '#D9F99D', '#FDBA74', '#93C5FD', '#F0ABFC', '#6EE7B7', '#FCD34D', '#A5B4FC', '#FDA4AF',
    '#67E8F9', '#BEF264', '#E9D5FF', '#FED7AA', '#99F6E4', '#C4B5FD',
  ];
  // 구간별 바탕(위→아래 그라디언트)과 네온 색. 짧은 코스는 0번만 쓴다
  const THEMES = [
    { bg: '#1B1530', bg2: '#211A3C', glow: '#8FB8FF' },   // 핀볼 숲
    { bg: '#111E35', bg2: '#172848', glow: '#4FD1C5' },   // 지그재그 슬로프
    { bg: '#21112E', bg2: '#2B163C', glow: '#E46BC4' },   // 범퍼 정원
    { bg: '#0D2127', bg2: '#122C34', glow: '#7DE38D' },   // 시계추 골짜기
    { bg: '#22180F', bg2: '#2D2015', glow: '#FFB547' },   // 회전 원판
    { bg: '#18122E', bg2: '#20183C', glow: '#C79BFF' },   // 레이저 커튼
  ];
  const themeOf = i => THEMES[Math.max(0, Math.min(THEMES.length - 1, i))];
  // 대기실(호스트·폰)에서 긴 코스는 1구간 바로 아래를 잘라 결승선을 붙여 보여준다
  const LOBBY = { cut: { y0: 30.9, y1: 32.1 }, finish: 32.3 };
  const cutText = map => `이 아래로 ${map.stages.length - 1}구간, ${Math.round(map.F - 31)}m 더 내려가요`;
  // 가장 흔한 칸(보통 '꽝')이 아닌 칸 = 당첨. 모두 한 칸씩이면 당첨 구분 없음
  function specialLabels(labels) {
    const count = {};
    for (const l of labels || []) count[l] = (count[l] || 0) + 1;
    const most = Math.max(0, ...Object.values(count));
    return new Set(most >= 2 ? Object.keys(count).filter(l => count[l] < most && l !== '?') : []);
  }
  const STACK = () => (root.Glyph ? root.Glyph.STACK : 'sans-serif');

  // ---------- 캔버스 ----------
  function setupCanvas(cv) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  // 미터 → px 변환. view 전체가 (w,h) 안에 들어오게 맞추고 가운데 정렬
  function makeT(w, h, view, pad) {
    pad = pad || 0;
    const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
    const k = Math.max(0.01, Math.min((w - 2 * pad) / vw, (h - 2 * pad) / vh));
    const ox = (w - vw * k) / 2 - view.x0 * k, oy = (h - vh * k) / 2 - view.y0 * k;
    return { k, ox, oy, w, h, x: m => ox + m * k, y: m => oy + m * k, mx: px => (px - ox) / k, my: py => (py - oy) / k };
  }

  function lighten(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.round(v + (255 - v) * amt);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
    const x = ch(pa), y = ch(pb);
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  }
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------- 에셋 (선택) ----------
  // assets/manifest.json의 images에 파일 이름이 있으면 불러서 쓰고, 없으면 그림으로 대신한다
  const Assets = {
    img: {}, patterns: new Map(),
    load() {
      if (typeof fetch === 'undefined') return Promise.resolve();
      return fetch('assets/manifest.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : {}))
        .then(m => Promise.all(Object.entries((m && m.images) || {}).filter(([, f]) => typeof f === 'string' && f).map(([key, file]) =>
          new Promise(res => {
            const im = new Image();
            im.onload = () => { this.img[key] = im; res(); };
            im.onerror = () => res();
            im.src = 'assets/' + file;
          }))))
        .catch(() => { /* 에셋 없이 진행 */ });
    },
    pattern(ctx, key) {
      const im = this.img[key];
      if (!im) return null;
      if (!this.patterns.has(key)) this.patterns.set(key, ctx.createPattern(im, 'repeat'));
      return this.patterns.get(key);
    },
  };

  // ---------- 이펙트 ----------
  class Fx {
    constructor(F) { this.F = F || C.FINISH_Y; this.list = []; this.kicks = []; this.shake = 0; }
    ring(x, y, color, r1) { this.list.push({ k: 'ring', x, y, color, r1: r1 || 1.4, life: 0.45, age: 0 }); }
    shards(x, y, color, n) {
      for (let i = 0; i < (n || 9); i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
        this.list.push({ k: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, rot: Math.random() * 6, color, life: 0.8, age: 0 });
      }
    }
    sparks(x, y, color, n) {
      for (let i = 0; i < (n || 8); i++) {
        const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 7;
        this.list.push({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: 0.35 + Math.random() * 0.2, age: 0 });
      }
    }
    confetti(x, y, n) {
      for (let i = 0; i < (n || 50); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 7 + Math.random() * 9;
        this.list.push({
          k: 'confetti', x: x + (Math.random() - 0.5) * 2, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, color: PALETTE[(Math.random() * PALETTE.length) | 0],
          life: 2.2 + Math.random() * 0.8, age: 0,
        });
      }
    }
    pulse(x, color) { this.list.push({ k: 'pulse', x, color, life: 0.9, age: 0 }); }
    laser(x) { this.list.push({ k: 'laser', x, life: 0.7, age: 0 }); }
    float(x, label, color) { this.list.push({ k: 'float', x, label, color, life: 1.6, age: 0 }); }
    kick(x, y) { this.kicks.push({ x, y, age: 0 }); }
    update(dt) {
      for (const e of this.list) {
        e.age += dt;
        if (e.k === 'shard') { e.vy += 14 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.rot += dt * 8; }
        else if (e.k === 'spark') { e.vx *= 1 - 3 * dt; e.vy *= 1 - 3 * dt; e.x += e.vx * dt; e.y += e.vy * dt; }
        else if (e.k === 'confetti') { e.vy += 9 * dt; e.vx *= 1 - 1.2 * dt; e.vy *= 1 - 1.2 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt; }
      }
      this.list = this.list.filter(e => e.age < e.life);
      for (const k of this.kicks) k.age += dt;
      this.kicks = this.kicks.filter(k => k.age < 0.3);
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    // 맵 범퍼가 튕길 때 커지는 정도 (0~1)
    kickNear(c, r) {
      let v = 0;
      for (const k of this.kicks) if (Math.hypot(k.x - c[0], k.y - c[1]) < r + 1.5) v = Math.max(v, 1 - k.age / 0.3);
      return v;
    }
    draw(ctx, T, F) {
      const k = T.k;
      F = F === undefined ? this.F : F;
      for (const e of this.list) {
        const p = e.age / e.life;
        if (e.k === 'ring') {
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1, 0.12 * k);
          ctx.beginPath(); ctx.arc(T.x(e.x), T.y(e.y), (0.3 + e.r1 * p) * k, 0, Math.PI * 2); ctx.stroke();
        } else if (e.k === 'shard') {
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = e.color;
          ctx.save(); ctx.translate(T.x(e.x), T.y(e.y)); ctx.rotate(e.rot);
          ctx.fillRect(-0.12 * k, -0.07 * k, 0.24 * k, 0.14 * k);
          ctx.restore();
        } else if (e.k === 'spark') {
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1, 0.07 * k);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(T.x(e.x), T.y(e.y)); ctx.lineTo(T.x(e.x - e.vx * 0.04), T.y(e.y - e.vy * 0.04)); ctx.stroke();
        } else if (e.k === 'confetti') {
          ctx.globalAlpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
          ctx.fillStyle = e.color;
          ctx.save(); ctx.translate(T.x(e.x), T.y(e.y)); ctx.rotate(e.rot);
          ctx.fillRect(-0.16 * k, -0.07 * k, 0.32 * k * Math.abs(Math.cos(e.rot * 1.7)) + 1, 0.14 * k);
          ctx.restore();
        } else if (e.k === 'pulse') {
          ctx.globalAlpha = (1 - p) * 0.8;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, 0.18 * k * (1 - p));
          const rx = (0.6 + 4.5 * p) * k, ry = (0.3 + 1.4 * p) * k;
          ctx.beginPath(); ctx.ellipse(T.x(e.x), T.y(F), rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (e.k === 'laser') {
          ctx.globalAlpha = 1 - p;
          const gx = T.x(e.x), gy = T.y(F), r = (0.6 + 1.6 * p) * k;
          const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
          gr.addColorStop(0, 'rgba(255,255,255,0.95)');
          gr.addColorStop(0.35, 'rgba(255,59,92,0.7)');
          gr.addColorStop(1, 'rgba(255,59,92,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
        } else if (e.k === 'float') {
          ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          ctx.fillStyle = e.color;
          ctx.font = `${Math.max(12, 0.9 * k)}px ${STACK()}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.strokeStyle = COL.inkDeep; ctx.lineWidth = Math.max(2, 0.12 * k); ctx.lineJoin = 'round';
          const y = T.y(F - 0.8 - p * 3.2);
          ctx.strokeText(e.label, T.x(e.x), y);
          ctx.fillText(e.label, T.x(e.x), y);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 작은 스프라이트 (핀) ----------
  const pinSprites = new Map();
  function pinSprite(rpx) {
    const r = Math.max(2, Math.round(rpx * 2) / 2);
    if (pinSprites.has(r)) return pinSprites.get(r);
    const s = Math.ceil(r * 2 + 4), cv = document.createElement('canvas');
    cv.width = s; cv.height = s;
    const g = cv.getContext('2d'), c = s / 2;
    const gr = g.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
    gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.35, '#DDE1EC'); gr.addColorStop(0.8, '#8F95AB'); gr.addColorStop(1, '#5D627A');
    g.fillStyle = gr;
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
    if (pinSprites.size > 60) pinSprites.clear();
    pinSprites.set(r, cv);
    return cv;
  }

  // ---------- 그리기 ----------
  /* scene: {
   *   map, view, clock(초, 장식 애니메이션), now(게임 시각 — 칸 번쩍임 기준),
   *   mills:[{el, angle}], movers:[{el, x, y, a}], obstacles, colorOf(owner),
   *   names:[{id, text, color, x, y, a, shape?, fontM, w, ghost, me}], trails:[{color, pts}],
   *   segs:[{label, w, closed, owner, closedAt}], blind,
   *   finishAt(결승선을 그릴 y — 대기실에서 긴 코스를 줄여 보여줄 때), cut:{y0, y1, text},
   *   showZone, showStart, showMillRange, halo, ghost, guide, fx, countdown:{n, f}
   * } */
  function drawScene(ctx, T, sc) {
    const k = T.k, W = C.W, map = sc.map, F = map.F;
    const FB = sc.finishAt === undefined ? F : sc.finishAt;
    const v = sc.view || map.view;
    const vy0 = v.y0 - 3, vy1 = sc.cut ? Math.min(v.y1 + 3, sc.cut.y0) : v.y1 + 3;
    const vis = (a, b) => b >= vy0 && a <= vy1;
    const clock = sc.clock || 0;
    spriteBudget = 6;

    // 1. 바깥 배경 + 옆 장식
    ctx.fillStyle = COL.inkDeep;
    ctx.fillRect(T.x(v.x0) - 4000, T.y(v.y0) - 4000, (v.x1 - v.x0) * k + 8000, (v.y1 - v.y0) * k + 8000);
    drawSides(ctx, T, v, map, clock);

    // 2. 플레이필드: 구간별 바탕 + 구간 제목
    const top = Math.max(-16, v.y0 - 1), floor = Math.max(F, FB) + C.LABEL_BAND;
    map.stages.forEach((s, i) => {
      const a = Math.max(s.y0, top), b = Math.min(s.y1, floor, vy1);
      if (b <= a || !vis(a, b)) return;
      const th = themeOf(map.stages.length > 1 ? i : 0);
      const g = ctx.createLinearGradient(0, T.y(Math.max(s.y0, -6)), 0, T.y(Math.min(s.y1, F)));
      g.addColorStop(0, th.bg2); g.addColorStop(1, th.bg);
      ctx.fillStyle = g;
      ctx.fillRect(T.x(0), T.y(a), W * k, (b - a) * k);
      const pat = Assets.pattern(ctx, 'stage' + (i + 1));
      if (pat) {
        if (pat.setTransform && root.DOMMatrix) pat.setTransform(new DOMMatrix().translate(T.ox, T.oy).scale(k / 64));
        ctx.globalAlpha = 0.35; ctx.fillStyle = pat;
        ctx.fillRect(T.x(0), T.y(a), W * k, (b - a) * k);
        ctx.globalAlpha = 1;
      }
      if (map.stages.length > 1 && i > 0 && vis(s.y0, s.y0 + 4)) {
        // 구간 경계: 네온 점선 + 큰 제목
        ctx.strokeStyle = alpha(th.glow, 0.35);
        ctx.lineWidth = Math.max(1, 0.06 * k);
        ctx.setLineDash([0.5 * k, 0.4 * k]);
        ctx.beginPath(); ctx.moveTo(T.x(0.3), T.y(s.y0)); ctx.lineTo(T.x(W - 0.3), T.y(s.y0)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = alpha(th.glow, 0.16);
        ctx.font = `${Math.max(14, 1.7 * k)}px ${STACK()}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(String(i + 1).padStart(2, '0') + '  ' + s.name, T.x(1.1), T.y(s.y0 + 0.7));
      }
    });
    if (k > 4) {
      ctx.fillStyle = 'rgba(164,156,196,0.14)';
      const ds = Math.max(1, 0.06 * k);
      for (let y = Math.ceil(Math.max(top, vy0) / 1.5) * 1.5; y < Math.min(F, vy1); y += 1.5) {
        for (let x = 1.5; x < W; x += 1.5) ctx.fillRect(T.x(x) - ds / 2, T.y(y) - ds / 2, ds, ds);
      }
    }

    // 3. 설치 구역
    if (sc.showZone) {
      const x0 = T.x(C.CLEAR_WALL), x1 = T.x(W - C.CLEAR_WALL), y0 = T.y(C.ZONE.y0), y1 = T.y(C.ZONE.y1);
      ctx.fillStyle = 'rgba(255,181,71,0.05)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([Math.max(3, 0.35 * k), Math.max(3, 0.3 * k)]);
      ctx.strokeStyle = 'rgba(255,181,71,0.75)';
      ctx.lineWidth = Math.max(1, 0.06 * k);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,181,71,0.85)';
      ctx.font = `${Math.max(10, 0.55 * k)}px "IBM Plex Sans KR", sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('장애물 설치 구역', x0 + 0.25 * k, y0 + 0.2 * k);
    }

    // 금지 구역 후광 (폰 장애물 편집 중)
    if (sc.halo) {
      ctx.fillStyle = 'rgba(255,107,122,0.11)';
      ctx.strokeStyle = 'rgba(255,107,122,0.11)';
      ctx.lineCap = 'round';
      for (const el of map.els) {
        if (el.kind === 'wall' || !elVisible(el, vy0, vy1)) continue;
        if (el.a) {
          ctx.lineWidth = (el.r + C.CLEAR_MAP) * 2 * k;
          ctx.beginPath(); ctx.moveTo(T.x(el.a[0]), T.y(el.a[1])); ctx.lineTo(T.x(el.b[0]), T.y(el.b[1])); ctx.stroke();
        } else {
          const r = el.kind === 'mill' || el.kind === 'pendulum' ? el.len + el.thick : el.r || 1;
          ctx.beginPath(); ctx.arc(T.x(el.c[0]), T.y(el.c[1]), (r + C.CLEAR_MAP) * k, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // 출발선
    if (sc.showStart) {
      ctx.setLineDash([Math.max(3, 0.3 * k), Math.max(3, 0.25 * k)]);
      ctx.strokeStyle = 'rgba(243,238,255,0.35)';
      ctx.lineWidth = Math.max(1, 0.05 * k);
      const y = T.y(C.START_Y + 0.75);
      ctx.beginPath(); ctx.moveTo(T.x(0.2), y); ctx.lineTo(T.x(W - 0.2), y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4. 맵 요소
    ctx.lineCap = 'round';
    for (const el of map.els) {
      if (!elVisible(el, vy0, vy1)) continue;
      if (el.kind === 'wall') drawWall(ctx, T, el, map, vy0, vy1);
      else if (el.kind === 'deflector') {
        const th = themeOf(map.stages.length > 1 ? Sim.stageAt(map, (el.a[1] + el.b[1]) / 2) : 0);
        glowLine(ctx, T, el.a, el.b, el.r, th.glow);
      } else if (el.kind === 'pin') {
        const r = el.r * k, sp = pinSprite(r);
        ctx.drawImage(sp, T.x(el.c[0]) - sp.width / 2, T.y(el.c[1]) - sp.height / 2);
      } else if (el.kind === 'bumper') {
        const kick = sc.fx ? sc.fx.kickNear(el.c, el.r) : 0, idle = 0.5 + 0.5 * Math.sin(clock * 3 + el.c[0] + el.c[1]);
        const x = T.x(el.c[0]), y = T.y(el.c[1]), r = el.r * (1 + 0.22 * kick) * k;
        ctx.fillStyle = alpha(COL.magenta, 0.16 + 0.3 * kick);
        ctx.beginPath(); ctx.arc(x, y, r + 0.25 * k * (0.5 + idle * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2A1030';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = kick > 0 ? lighten(COL.magenta, 0.5 * kick) : COL.magenta;
        ctx.lineWidth = Math.max(2, 0.2 * k);
        ctx.beginPath(); ctx.arc(x, y, r - 0.1 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = lighten(COL.magenta, 0.15 + 0.3 * idle);
        ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const m of sc.mills || []) {
      const el = m.el;
      if (!vis(el.c[1] - el.len - 1, el.c[1] + el.len + 1)) continue;
      const th = themeOf(map.stages.length > 1 ? Sim.stageAt(map, el.c[1]) : 0);
      const x = T.x(el.c[0]), y = T.y(el.c[1]);
      if (sc.showMillRange) {
        ctx.strokeStyle = 'rgba(201,206,221,0.16)';
        ctx.lineWidth = Math.max(1, 0.05 * k);
        ctx.beginPath(); ctx.arc(x, y, (el.len + el.thick / 2) * k, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(m.angle);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = alpha(th.glow, 0.25);
      ctx.lineWidth = Math.max(5, (el.thick + 0.45) * k);
      ctx.beginPath(); ctx.moveTo(-el.len * k, 0); ctx.lineTo(el.len * k, 0); ctx.moveTo(0, -el.len * k); ctx.lineTo(0, el.len * k); ctx.stroke();
      ctx.strokeStyle = COL.chrome;
      ctx.lineWidth = Math.max(2, el.thick * k);
      ctx.beginPath(); ctx.moveTo(-el.len * k, 0); ctx.lineTo(el.len * k, 0); ctx.moveTo(0, -el.len * k); ctx.lineTo(0, el.len * k); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = COL.amber;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, 0.36 * k), 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'round';
    }
    for (const m of sc.movers || []) drawMover(ctx, T, m, map, vis);

    // 5. 유저 장애물
    for (const o of sc.obstacles || []) {
      if (o.alive === false || !vis(o.y - 2, o.y + 2)) continue;
      drawObstacle(ctx, T, o, sc.colorOf ? sc.colorOf(o.owner) : COL.chrome, 1);
    }
    if (sc.ghost) {
      ctx.globalAlpha = 0.6;
      drawObstacle(ctx, T, Object.assign({ hp: OBS[sc.ghost.kind].hp, flash: 0 }, sc.ghost), sc.ghost.ok ? COL.good : COL.bad, 1.6);
      ctx.globalAlpha = 1;
    }

    // 6. 줄여 보여주기 표시 + 레이저 결승선
    if (sc.cut) drawCut(ctx, T, sc.cut, v.y1 + 3);
    if (sc.cut || vis(FB - 1, FB + C.LABEL_BAND)) drawFinish(ctx, T, sc, FB);

    // 출발 위치 가이드 (폰)
    if (sc.guide) {
      ctx.setLineDash([Math.max(3, 0.25 * k), Math.max(3, 0.22 * k)]);
      ctx.strokeStyle = 'rgba(255,181,71,0.8)';
      ctx.lineWidth = Math.max(1.5, 0.07 * k);
      ctx.beginPath(); ctx.moveTo(T.x(sc.guide.x), T.y(sc.guide.y + 0.6)); ctx.lineTo(T.x(sc.guide.x), T.y(Math.min(FB, sc.cut ? sc.cut.y0 : FB))); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 7. 꼬리 + 이름
    if (sc.trails) drawTrails(ctx, T, sc.trails);
    for (const n of sc.names || []) if (n.y - 3 <= v.y1 + 3 && n.y + 3 >= vy0) drawName(ctx, T, n);

    // 8. 이펙트
    if (sc.fx) sc.fx.draw(ctx, T, FB);

    if (sc.countdown) {
      const { n, f } = sc.countdown, s = 1.25 - 0.25 * (1 - Math.pow(1 - Math.min(1, f * 2.2), 3));
      const cx = (T.x(v.x0) + T.x(v.x1)) / 2, cy = (T.y(v.y0) + T.y(v.y1)) / 2;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
      ctx.globalAlpha = 1 - 0.35 * f;
      ctx.font = `${Math.max(60, Math.min(T.w, T.h) * 0.32)}px ${STACK()}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(4, 0.5 * k); ctx.strokeStyle = COL.inkDeep; ctx.lineJoin = 'round';
      ctx.strokeText(String(n), 0, 0);
      ctx.fillStyle = COL.amber;
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function elVisible(el, y0, y1) {
    let a, b;
    if (el.a) { a = Math.min(el.a[1], el.b[1]) - el.r; b = Math.max(el.a[1], el.b[1]) + el.r; }
    else {
      const r = el.kind === 'mill' || el.kind === 'pendulum' ? el.len + el.thick : el.kind === 'slider' ? el.len : el.r || 1;
      a = el.c[1] - r; b = el.c[1] + r;
    }
    return b >= y0 && a <= y1;
  }

  // 네온 선: 넓고 옅은 빛 + 크롬 심
  function glowLine(ctx, T, a, b, r, glow) {
    const k = T.k;
    ctx.lineCap = 'round';
    ctx.strokeStyle = alpha(glow, 0.22);
    ctx.lineWidth = Math.max(5, (r * 2 + 0.55) * k);
    ctx.beginPath(); ctx.moveTo(T.x(a[0]), T.y(a[1])); ctx.lineTo(T.x(b[0]), T.y(b[1])); ctx.stroke();
    ctx.strokeStyle = COL.chrome;
    ctx.lineWidth = Math.max(1.5, r * 2 * k);
    ctx.beginPath(); ctx.moveTo(T.x(a[0]), T.y(a[1])); ctx.lineTo(T.x(b[0]), T.y(b[1])); ctx.stroke();
  }
  // 옆벽은 구간마다 네온 색이 바뀐다
  function drawWall(ctx, T, el, map, y0, y1) {
    if (el.a[0] !== el.b[0] || map.stages.length < 2) { glowLine(ctx, T, el.a, el.b, el.r, themeOf(0).glow); return; }
    const lo = Math.min(el.a[1], el.b[1]), hi = Math.max(el.a[1], el.b[1]);
    map.stages.forEach((s, i) => {
      const a = Math.max(lo, s.y0, y0), b = Math.min(hi, s.y1, y1);
      if (b > a) glowLine(ctx, T, [el.a[0], a], [el.a[0], b], el.r, themeOf(i).glow);
    });
  }

  function drawMover(ctx, T, m, map, vis) {
    const el = m.el, k = T.k, th = themeOf(map.stages.length > 1 ? Sim.stageAt(map, el.c[1]) : 0);
    if (el.kind === 'pendulum') {
      if (!vis(el.c[1] - 1, el.c[1] + el.len + 1)) return;
      const sx = -Math.sin(m.a) * el.len, sy = Math.cos(m.a) * el.len;
      glowLine(ctx, T, [m.x, m.y], [m.x + sx, m.y + sy], el.thick / 2, th.glow);
      ctx.fillStyle = COL.amber;
      ctx.beginPath(); ctx.arc(T.x(m.x), T.y(m.y), Math.max(3, 0.62 * k), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.inkDeep;
      ctx.beginPath(); ctx.arc(T.x(m.x), T.y(m.y), Math.max(1.5, 0.22 * k), 0, Math.PI * 2); ctx.fill();
    } else if (el.kind === 'slider') {
      if (!vis(el.c[1] - 2, el.c[1] + 2)) return;
      // 오가는 길 표시
      ctx.setLineDash([0.3 * k, 0.3 * k]);
      ctx.strokeStyle = alpha(th.glow, 0.25);
      ctx.lineWidth = Math.max(1, 0.06 * k);
      ctx.beginPath(); ctx.moveTo(T.x(el.c[0] - el.amp - el.len / 2), T.y(el.c[1])); ctx.lineTo(T.x(el.c[0] + el.amp + el.len / 2), T.y(el.c[1])); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save(); ctx.translate(T.x(m.x), T.y(m.y)); ctx.rotate(m.a);
      const hw = el.len / 2 * k, hh = el.thick / 2 * k;
      ctx.fillStyle = alpha(th.glow, 0.22);
      roundRect(ctx, -hw - 0.2 * k, -hh - 0.2 * k, hw * 2 + 0.4 * k, hh * 2 + 0.4 * k, hh + 0.2 * k); ctx.fill();
      ctx.fillStyle = COL.chrome;
      roundRect(ctx, -hw, -hh, hw * 2, hh * 2, Math.min(hh, 0.12 * k)); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = COL.amber;
      for (let x = -hw; x < hw; x += 0.7 * k) { ctx.beginPath(); ctx.moveTo(x, hh); ctx.lineTo(x + 0.35 * k, -hh); ctx.lineTo(x + 0.6 * k, -hh); ctx.lineTo(x + 0.25 * k, hh); ctx.fill(); }
      ctx.restore();
      ctx.restore();
    } else if (el.kind === 'disc') {
      if (!vis(el.c[1] - el.r - 1, el.c[1] + el.r + 1)) return;
      const x = T.x(m.x), y = T.y(m.y), r = el.r * k;
      ctx.fillStyle = alpha(th.glow, 0.18);
      ctx.beginPath(); ctx.arc(x, y, r + 0.3 * k, 0, Math.PI * 2); ctx.fill();
      const gr = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
      gr.addColorStop(0, '#3A2C1C'); gr.addColorStop(1, '#5A4429');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = th.glow; ctx.lineWidth = Math.max(2, 0.16 * k);
      ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(m.a);
      ctx.strokeStyle = alpha(th.glow, 0.7); ctx.lineWidth = Math.max(1.5, 0.12 * k);
      for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); ctx.beginPath(); ctx.moveTo(r * 0.2, 0); ctx.lineTo(r * 0.85, 0); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = COL.amber;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, 0.3 * k), 0, Math.PI * 2); ctx.fill();
    }
  }

  // 화면 밖(보드 좌우) 장식: 네온 레일과 깜박이는 조명. side 에셋이 있으면 그 그림을 세로로 이어 붙인다
  function drawSides(ctx, T, v, map, clock) {
    const k = T.k, W = C.W;
    const lw = T.x(0) - T.x(v.x0), rw = T.x(v.x1) - T.x(W);
    const yTop = T.y(v.y0) - 50, yBot = T.y(v.y1) + 50;
    const img = Assets.img.side;
    if (img && (lw > 30 || rw > 30)) {
      const drawCol = (x, w, flip) => {
        if (w <= 4) return;
        const th = img.height * (w / img.width), off = ((T.oy * 0.6) % th + th) % th;
        ctx.save();
        if (flip) { ctx.translate(x + w, 0); ctx.scale(-1, 1); x = 0; }
        for (let y = yTop - off; y < yBot; y += th) ctx.drawImage(img, x, y, w, th);
        ctx.restore();
      };
      drawCol(T.x(v.x0) - 1, lw - 0.3 * k, false);
      drawCol(T.x(W) + 0.3 * k, rw - 0.3 * k + 1, true);
    }
    // 레일
    const rails = [-0.42, W + 0.42];
    for (const rx of rails) {
      if (T.x(rx) < -20 || T.x(rx) > T.w + 20) continue;
      ctx.strokeStyle = 'rgba(143,184,255,0.10)';
      ctx.lineWidth = Math.max(3, 0.3 * k);
      ctx.beginPath(); ctx.moveTo(T.x(rx), yTop); ctx.lineTo(T.x(rx), yBot); ctx.stroke();
      // 2m마다 작은 조명, 시간에 따라 위에서 아래로 흐르듯 깜박임
      for (let y = Math.ceil(v.y0 / 2) * 2; y < v.y1; y += 2) {
        const si = map.stages.length > 1 ? Sim.stageAt(map, y) : 0;
        const on = 0.25 + 0.75 * Math.max(0, Math.sin(clock * 4 - y * 0.35));
        ctx.fillStyle = alpha(themeOf(si).glow, 0.18 + 0.5 * on);
        ctx.beginPath(); ctx.arc(T.x(rx), T.y(y), Math.max(1.2, 0.09 * k), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawCut(ctx, T, cut, bottom) {
    const k = T.k, W = C.W, y0 = T.y(cut.y0), y1 = T.y(cut.y1);
    ctx.fillStyle = COL.inkDeep;
    ctx.fillRect(T.x(0) - 1, y0, W * k + 2, T.y(bottom) - y0);
    // 지그재그 절단선
    ctx.strokeStyle = 'rgba(201,206,221,0.45)';
    ctx.lineWidth = Math.max(1, 0.05 * k);
    for (const y of [y0, y1]) {
      ctx.beginPath();
      for (let x = 0, i = 0; x <= W; x += 0.6, i++) { const px = T.x(x), py = y + (i % 2 ? 0.12 : -0.12) * k; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    }
    ctx.fillStyle = COL.muted;
    ctx.font = `${Math.max(10, 0.5 * k)}px "IBM Plex Sans KR", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cut.text, T.x(W / 2), (y0 + y1) / 2);
  }

  function drawTrails(ctx, T, trails) {
    const k = T.k;
    ctx.lineCap = 'round';
    for (const tr of trails) {
      const p = tr.pts, n = p.length;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        ctx.strokeStyle = alpha(tr.color, 0.32 * f);
        ctx.lineWidth = Math.max(1, (0.08 + 0.28 * f) * k);
        ctx.beginPath(); ctx.moveTo(T.x(p[i - 1][0]), T.y(p[i - 1][1])); ctx.lineTo(T.x(p[i][0]), T.y(p[i][1])); ctx.stroke();
      }
    }
  }

  function drawObstacle(ctx, T, o, edge, edgeScale) {
    const k = T.k, def = OBS[o.kind], fl = o.flash || 0;
    ctx.save();
    ctx.translate(T.x(o.x), T.y(o.y));
    ctx.lineJoin = 'round';
    if (def.shape === 'circle') {
      const r = def.r * k;
      ctx.fillStyle = fl > 0 ? lighten(COL.magenta, fl * 0.6) : COL.magenta;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1.5, 0.12 * k * edgeScale);
      ctx.stroke();
      dots(ctx, o.hp, def.hp, 0, 0, k, COL.inkDeep);
    } else {
      ctx.rotate(o.a);
      const hw = def.len / 2 * k, hh = def.th / 2 * k;
      if (o.kind === 'tramp') {
        // 스프링 (윗면 반대쪽)
        ctx.strokeStyle = COL.chrome;
        ctx.lineWidth = Math.max(1, 0.05 * k);
        ctx.beginPath();
        const n = 8, sy = hh, ey = hh + 0.38 * k;
        for (let i = 0; i <= n; i++) {
          const x = -hw * 0.8 + (hw * 1.6) * i / n, y = i % 2 ? ey : sy + 0.06 * k;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = fl > 0 ? lighten(COL.teal, fl * 0.6) : COL.teal;
      } else {
        ctx.fillStyle = fl > 0 ? lighten(COL.brick, fl * 0.6) : COL.brick;
      }
      roundRect(ctx, -hw, -hh, hw * 2, hh * 2, Math.min(hh, 0.1 * k));
      ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1.5, 0.12 * k * edgeScale);
      ctx.stroke();
      if (o.kind === 'block') {
        // 맞을 때마다 금이 하나씩
        ctx.strokeStyle = COL.inkDeep; ctx.lineWidth = Math.max(1, 0.05 * k);
        const lost = def.hp - (o.hp === undefined ? def.hp : o.hp);
        for (let i = 0; i < lost; i++) {
          const cx = (-0.6 + i * 0.6) * k;
          ctx.beginPath();
          ctx.moveTo(cx - 0.1 * k, -hh); ctx.lineTo(cx + 0.08 * k, -hh * 0.2);
          ctx.lineTo(cx - 0.06 * k, hh * 0.3); ctx.lineTo(cx + 0.1 * k, hh);
          ctx.stroke();
        }
      } else {
        dots(ctx, o.hp, def.hp, 0, 0, k, COL.inkDeep);
      }
    }
    ctx.restore();
  }
  function dots(ctx, hp, max, x, y, k, color) {
    const n = hp === undefined ? max : hp, r = Math.max(1.2, 0.08 * k), gap = 0.26 * k;
    for (let i = 0; i < max; i++) {
      ctx.beginPath(); ctx.arc(x + (i - (max - 1) / 2) * gap, y, r, 0, Math.PI * 2);
      if (i < n) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFinish(ctx, T, sc, F) {
    const k = T.k, B = C.LABEL_BAND, W = C.W;
    ctx.fillStyle = '#100B1F';
    ctx.fillRect(T.x(0), T.y(F), W * k, B * k);
    const segs = sc.segs || [];
    let x = 0;
    const now = sc.now || 0;
    const bounds = segs.map(s => { const a = x; x += s.w; return [a, x]; });
    // 레이저 선. 글로우는 shadowBlur 대신 넓고 옅은 선을 한 번 더 그린다 (30칸 × 매 프레임 블러는 느림)
    ctx.save();
    ctx.lineCap = 'butt';
    segs.forEach((s, i) => {
      const [a, c] = bounds[i];
      if (c - a < 0.004) return;
      let color = COL.laser, lw = 0.13;
      if (s.closed) {
        const p = Math.min(1, (now - s.closedAt) / 1.2);
        color = p < 0.5 ? mix(COL.amber, '#ffffff', p * 2) : mix('#ffffff', COL.laser, (p - 0.5) * 2);
        lw = 0.22;
      }
      const x0 = T.x(a + 0.06), x1 = T.x(c - 0.06), y = T.y(F);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = Math.max(6, (lw + 0.5) * k);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(2, lw * k);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    });
    ctx.restore();
    // 칸막이
    ctx.fillStyle = COL.chrome;
    const pw = Math.max(1.5, 0.09 * k);
    for (let i = 0; i <= bounds.length; i++) {
      const bx = i < bounds.length ? bounds[i][0] : W;
      if (i > 0 && i < bounds.length && bounds[i][1] - bounds[i][0] < 0.004 && bounds[i - 1][1] - bounds[i - 1][0] < 0.004) continue;
      ctx.fillRect(T.x(bx) - pw / 2, T.y(F - 0.35), pw, (B + 0.35) * k);
    }
    // 칸 이름
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fam = STACK();
    segs.forEach((s, i) => {
      const [a, c] = bounds[i], w = c - a;
      if (w < 0.12) return;
      const label = s.closed || !sc.blind ? s.label : '?';
      let size = 0.85;
      ctx.font = `${size * k}px ${fam}`;
      const tw = ctx.measureText(label).width / k;
      if (tw > w - 0.12) {
        size = Math.max(0.34, size * (w - 0.12) / tw);
        ctx.font = `${size * k}px ${fam}`;
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(T.x(a) + 1, T.y(F), w * k - 2, B * k); ctx.clip();
      const special = !s.closed && !sc.blind && sc.special && sc.special.has(s.label);   // 당첨 칸은 앰버로 눈에 띄게
      ctx.fillStyle = s.closed ? (sc.colorOf ? sc.colorOf(s.owner) : COL.amber) : special ? COL.amber : COL.text;
      ctx.globalAlpha = s.closed ? Math.max(0.35, Math.min(1, w / 0.5)) : 1;
      ctx.fillText(label, T.x(a + w / 2), T.y(F + B / 2));
      ctx.restore();
    });
  }

  // 게임 중 이름은 매 프레임 회전된 글자를 새로 그리면 느리다(30명이면 프레임당 100ms 넘게 걸리기도 함).
  // 이름마다 한 번 비트맵으로 그려 두고 drawImage로 돌려 그린다. 확대 배율이 크게 바뀔 때만 다시 만든다.
  const sprites = new Map();   // 이름별 → (해상도 → 스프라이트)
  const RES = [12, 18, 24, 32, 48, 64, 96, 128, 192];
  let spriteBudget = 0, spriteCount = 0;   // 확대 배율이 바뀌어도 프레임당 몇 개씩만 다시 만든다
  function nameSprite(shape, color, need) {
    const want = RES.find(r => r >= need) || RES[RES.length - 1];
    const key = shape.text + '|' + shape.fontM.toFixed(3) + '|' + color;
    let set = sprites.get(key);
    if (!set) { set = new Map(); sprites.set(key, set); }
    let sp = set.get(want);
    if (sp) return sp;
    if (set.size && spriteBudget <= 0) {
      let best = null;
      for (const s of set.values()) if (!best || Math.abs(Math.log(s.res / want)) < Math.abs(Math.log(best.res / want))) best = s;
      return best;
    }
    spriteBudget--;
    if (spriteCount > 400) { sprites.clear(); spriteCount = 0; set = new Map(); sprites.set(key, set); }
    const pad = 0.25, bw = shape.bw || shape.w;
    const x0 = Math.min(shape.ox, -bw / 2) - pad, x1 = Math.max(shape.ox + shape.w, bw / 2) + pad;
    const y0 = Math.min(shape.oy - shape.fontM * 0.8, -shape.h / 2) - pad, y1 = Math.max(shape.oy + shape.fontM * 0.8, shape.h / 2) + pad;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil((x1 - x0) * want)); cv.height = Math.max(1, Math.ceil((y1 - y0) * want));
    const g = cv.getContext('2d');
    g.translate(-x0 * want, -y0 * want);
    root.Glyph.draw(g, shape, want, color, COL.inkDeep, Math.max(2, 0.11 * want));
    sp = { cv, res: want, x0, y0, w: x1 - x0, h: y1 - y0 };
    set.set(want, sp);
    spriteCount++;
    return sp;
  }
  // 대기실 이름(물리 모양 없음)도 가운데 정렬로 같은 방식으로 그린다
  function textShape(n) {
    const fontM = n.fontM || 1, w = n.w || fontM * Math.max(1, Array.from(n.text).length);
    return { text: n.text, fontM, ox: -w / 2, oy: 0, w, h: fontM, bw: w };
  }

  function drawName(ctx, T, n) {
    const k = T.k, shape = n.shape || textShape(n);
    ctx.save();
    ctx.translate(T.x(n.x), T.y(n.y));
    if (n.a) ctx.rotate(n.a);
    if (n.ghost) ctx.globalAlpha = 0.45;
    if (n.me) { ctx.shadowColor = COL.amber; ctx.shadowBlur = Math.max(8, 0.6 * k); }
    if (typeof document !== 'undefined') {
      const sp = nameSprite(shape, n.color, k * Math.min(2, Math.max(1, root.devicePixelRatio || 1)));
      ctx.drawImage(sp.cv, sp.x0 * k, sp.y0 * k, sp.w * k, sp.h * k);
    } else {
      root.Glyph.draw(ctx, shape, k, n.color, COL.inkDeep, Math.max(2, 0.11 * k));
    }
    if (n.me) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = COL.amber;
      ctx.beginPath();
      const ty = -((n.fontM || 1) * 0.5 + 0.35) * k;
      ctx.moveTo(-0.22 * k, ty - 0.3 * k); ctx.lineTo(0.22 * k, ty - 0.3 * k); ctx.lineTo(0, ty);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 미니맵 ----------
  // 코스 전체를 세로 띠로. 정적인 부분은 한 번 그려 두고, 이름 점과 카메라 창만 매 프레임 그린다
  const mm = { key: '', cv: null };
  function minimapGeom(map, rect) {
    const y0 = -6, y1 = map.F + C.LABEL_BAND + 1, s = Math.min(rect.h / (y1 - y0), rect.w / (C.W + 2));
    const w = C.W * s, x = rect.x + (rect.w - w) / 2, top = rect.y + (rect.h - (y1 - y0) * s) / 2;
    return { s, x, top, y0, y1, w, h: (y1 - y0) * s, toY: py => y0 + (py - top) / s };
  }
  function drawMinimap(ctx, rect, info) {
    const map = info.map, g = minimapGeom(map, rect), dpr = Math.min(2, root.devicePixelRatio || 1);
    const key = [map.id, Math.round(rect.w), Math.round(rect.h), dpr].join('|');
    if (mm.key !== key) {
      mm.key = key;
      const cv = mm.cv = document.createElement('canvas');
      cv.width = Math.ceil((g.w + 8) * dpr); cv.height = Math.ceil((g.h + 8) * dpr);
      const c = cv.getContext('2d');
      c.scale(dpr, dpr); c.translate(4, 4);
      const X = x => x * g.s, Y = y => (y - g.y0) * g.s;
      c.fillStyle = 'rgba(20,15,38,0.88)';
      roundRect(c, -4, -4, g.w + 8, g.h + 8, 6); c.fill();
      map.stages.forEach((s, i) => {
        const a = Math.max(s.y0, g.y0), b = Math.min(s.y1, map.F);
        if (b <= a) return;
        c.fillStyle = themeOf(map.stages.length > 1 ? i : 0).bg2;
        c.fillRect(0, Y(a), g.w, (b - a) * g.s);
        if (i > 0) { c.fillStyle = alpha(themeOf(i).glow, 0.5); c.fillRect(0, Y(s.y0), g.w, 1); }
      });
      c.strokeStyle = 'rgba(201,206,221,0.75)'; c.fillStyle = 'rgba(201,206,221,0.75)';
      c.lineWidth = 1; c.lineCap = 'round';
      for (const el of map.els) {
        if (el.kind === 'wall' && el.a[1] === el.b[1]) continue;
        if (el.a) { c.beginPath(); c.moveTo(X(el.a[0]), Y(Math.max(el.a[1], g.y0))); c.lineTo(X(el.b[0]), Y(Math.max(el.b[1], g.y0))); c.stroke(); }
        else if (el.kind === 'pendulum') { c.beginPath(); c.moveTo(X(el.c[0]), Y(el.c[1])); c.lineTo(X(el.c[0]), Y(el.c[1] + el.len)); c.stroke(); }
        else if (el.kind === 'slider') { c.beginPath(); c.moveTo(X(el.c[0] - el.len / 2), Y(el.c[1])); c.lineTo(X(el.c[0] + el.len / 2), Y(el.c[1])); c.stroke(); }
        else if (el.kind === 'mill') { c.beginPath(); c.arc(X(el.c[0]), Y(el.c[1]), Math.max(1, el.len * g.s * 0.7), 0, Math.PI * 2); c.stroke(); }
        else { c.beginPath(); c.arc(X(el.c[0]), Y(el.c[1]), Math.max(0.8, el.r * g.s), 0, Math.PI * 2); c.fill(); }
      }
      c.fillStyle = COL.laser;
      c.fillRect(0, Y(map.F) - 1, g.w, 2.5);
    }
    ctx.drawImage(mm.cv, g.x - 4, g.top - 4, g.w + 8, g.h + 8);
    const X = x => g.x + x * g.s, Y = y => g.top + (y - g.y0) * g.s;
    if (info.view) {
      const a = Math.max(info.view.y0, g.y0), b = Math.min(info.view.y1, g.y1);
      ctx.fillStyle = 'rgba(243,238,255,0.07)';
      ctx.fillRect(g.x - 2, Y(a), g.w + 4, Math.max(2, (b - a) * g.s));
      ctx.strokeStyle = 'rgba(243,238,255,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(g.x - 2, Y(a), g.w + 4, Math.max(2, (b - a) * g.s));
    }
    for (const n of info.names || []) {
      const r = n.lead ? 3.4 : 2.4;
      ctx.fillStyle = n.color;
      ctx.beginPath(); ctx.arc(X(Math.max(0, Math.min(C.W, n.x))), Y(Math.max(g.y0, Math.min(g.y1, n.y))), r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = n.lead ? '#FFFFFF' : COL.inkDeep; ctx.lineWidth = n.lead ? 1.5 : 1;
      ctx.stroke();
    }
    return g;
  }

  // ---------- 사운드 ----------
  const Sound = {
    ac: null, on: true, last: {},
    unlock() {
      try {
        if (!this.ac) { const AC = root.AudioContext || root.webkitAudioContext; if (AC) this.ac = new AC(); }
        if (this.ac && this.ac.state === 'suspended') this.ac.resume();
      } catch (e) { /* 소리 없이 진행 */ }
    },
    tone(f0, f1, dur, type, vol, delay) {
      const a = this.ac, t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, hp) {
      const a = this.ac, t = a.currentTime, n = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = a.createBufferSource(), g = a.createGain();
      s.buffer = buf; g.gain.value = vol;
      if (hp) {
        const f = a.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3200, t + dur);
        s.connect(f).connect(g).connect(a.destination);
      } else s.connect(g).connect(a.destination);
      s.start(t);
    },
    play(kind) {
      if (!this.on || !this.ac || this.ac.state !== 'running') return;
      const now = performance.now();
      if (now - (this.last[kind] || 0) < 40) return;
      this.last[kind] = now;
      try {
        if (kind === 'bump') this.tone(180, 90, 0.14, 'sine', 0.22);
        else if (kind === 'hit') this.tone(900, 600, 0.05, 'square', 0.06);
        else if (kind === 'break') this.noise(0.22, 0.18);
        else if (kind === 'tramp') this.tone(260, 720, 0.18, 'triangle', 0.16);
        else if (kind === 'confirm') { this.tone(1320, 1320, 0.35, 'sine', 0.18); this.tone(1980, 1980, 0.25, 'sine', 0.06); }
        else if (kind === 'tick') this.tone(660, 660, 0.09, 'square', 0.07);
        else if (kind === 'go') this.tone(990, 990, 0.3, 'square', 0.08);
        else if (kind === 'stage') { this.noise(0.45, 0.07, true); this.tone(330, 495, 0.25, 'triangle', 0.08, 0.05); }
        else if (kind === 'rush') { this.tone(220, 880, 0.6, 'sawtooth', 0.06); }
        else if (kind === 'win') [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.28, 'triangle', 0.14, i * 0.09));
      } catch (e) { /* 무시 */ }
    },
  };

  // ---------- 토스트 ----------
  function toast(msg, kind, ms) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms || 2600);
  }

  root.Render = {
    COL, PALETTE, THEMES, LOBBY, cutText, specialLabels, themeOf, setupCanvas, makeT, drawScene, drawObstacle, drawMinimap, minimapGeom,
    Fx, Sound, Assets, toast, lighten, alpha,
  };
})(typeof self !== 'undefined' ? self : this);
