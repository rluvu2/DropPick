/* 핀볼 사다리 — 보드 렌더링 (호스트·폰 공용) + 이펙트 + 미니맵 + 전체 지도 + 사운드 + 에셋
 * 네온 아케이드: 어두운 구간 그림 위에 흰 심 + 색 빛의 네온관, 맞으면 반짝이는 핀, 빛나는 이름.
 * 빛 번짐은 shadowBlur 대신 'lighter'로 옅은 선을 겹쳐 그리고(30명 × 매 프레임 블러는 느림),
 * 비싼 그림(핀, 이름, 왕관)은 스프라이트로 한 번만 그려 둔다.
 */
(function (root) {
  'use strict';
  const Sim = root.Sim, C = Sim.C, OBS = Sim.OBS;

  const COL = {
    void: '#06040D', inkDeep: '#140F26', ink: '#1B1530', ink2: '#221A3E', ink3: '#2F2652', line: '#463B73',
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
  // 구간별 바탕(그림이 없을 때 그라디언트)과 네온 색. 짧은 코스는 0번만 쓴다
  const THEMES = [
    { bg: '#1B1530', bg2: '#211A3C', glow: '#8FB8FF' },   // 핀볼 숲
    { bg: '#111E35', bg2: '#172848', glow: '#4FD1C5' },   // 지그재그 슬로프
    { bg: '#21112E', bg2: '#2B163C', glow: '#F06BD0' },   // 범퍼 정원
    { bg: '#0D2127', bg2: '#122C34', glow: '#7DE38D' },   // 시계추 골짜기
    { bg: '#22180F', bg2: '#2D2015', glow: '#FFB547' },   // 회전 원판
    { bg: '#18122E', bg2: '#20183C', glow: '#C79BFF' },   // 레이저 커튼
  ];
  const themeOf = i => THEMES[Math.max(0, Math.min(THEMES.length - 1, i))];
  const stageTheme = (map, y) => themeOf(map.stages.length > 1 ? Sim.stageAt(map, y) : 0);
  // 폰 대기실에서 긴 코스는 1구간 바로 아래를 잘라 결승선을 붙여 보여준다 (PC는 전체 지도)
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
  const TAU = Math.PI * 2;

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
    return tOf(k, ox, oy, w, h);
  }
  function tOf(k, ox, oy, w, h) {
    return { k, ox, oy, w, h, x: m => ox + m * k, y: m => oy + m * k, mx: px => (px - ox) / k, my: py => (py - oy) / k };
  }

  // 색 문자열은 매 프레임 새로 만들지 않게 기억해 둔다
  const memo = new Map();
  function remember(key, make) { let v = memo.get(key); if (v === undefined) { if (memo.size > 6000) memo.clear(); v = make(); memo.set(key, v); } return v; }
  const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  function lighten(hex, amt) {
    amt = Math.round(amt * 100) / 100;
    return remember('l' + hex + amt, () => { const c = rgbOf(hex); return `rgb(${c.map(v => Math.round(v + (255 - v) * amt)).join(',')})`; });
  }
  function alpha(hex, a) {
    a = Math.round(Math.max(0, Math.min(1, a)) * 100) / 100;
    return remember('a' + hex + a, () => { const c = rgbOf(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; });
  }
  function mix(a, b, t) {   // → '#rrggbb'
    t = Math.round(Math.max(0, Math.min(1, t)) * 50) / 50;
    return remember('m' + a + b + t, () => { const x = rgbOf(a), y = rgbOf(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); });
  }

  // ---------- 에셋 (선택) ----------
  // assets/manifest.json의 images에 파일 이름이 있으면 불러서 쓰고, 없으면 그림으로 대신한다.
  // keys를 주면 그것만 (폰은 1구간 바닥만 쓴다). 그림이 올 때마다 rev가 올라가서 다시 그릴 때를 알 수 있다
  const Assets = {
    img: {}, rev: 0,
    load(keys) {
      if (typeof fetch === 'undefined') return Promise.resolve();
      return fetch('assets/manifest.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : {}))
        .then(m => Promise.all(Object.entries((m && m.images) || {})
          .filter(([key, f]) => typeof f === 'string' && f && (!keys || keys.includes(key)))
          .map(([key, file]) => new Promise(res => {
            const im = new Image();
            im.decoding = 'async';
            // 처음 그릴 때 화면을 멈추고 풀지 않게, 쓰기 전에 미리 풀어 둔다
            im.onload = () => { const ok = () => { this.img[key] = im; this.rev++; res(); }; if (im.decode) im.decode().then(ok, ok); else ok(); };
            im.onerror = () => res();
            im.src = 'assets/' + file;
          }))))
        .catch(() => { /* 에셋 없이 진행 */ });
    },
  };

  // ---------- 이펙트 ----------
  // 월드 좌표(m)로 움직이는 입자들. 많아지면 오래된 것부터 버린다
  const MAX_FX = 900;
  class Fx {
    constructor(F) { this.F = F || C.FINISH_Y; this.list = []; this.kicks = []; this.lit = new Map(); this.shake = 0; this.flash = 0; this.flashColor = '#FFFFFF'; }
    add(e) { if (this.list.length >= MAX_FX) this.list.splice(0, this.list.length - MAX_FX + 1); e.age = 0; this.list.push(e); }
    ring(x, y, color, r1) { this.add({ k: 'ring', x, y, color, r1: r1 || 1.4, life: 0.45 }); }
    shards(x, y, color, n) {
      for (let i = 0; i < (n || 9); i++) {
        const a = Math.random() * TAU, s = 2 + Math.random() * 5;
        this.add({ k: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, rot: Math.random() * 6, color, life: 0.8 });
      }
    }
    sparks(x, y, color, n, speed) {
      speed = speed || 1;
      for (let i = 0; i < (n || 8); i++) {
        const a = Math.random() * TAU, s = (5 + Math.random() * 7) * speed;
        this.add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: 0.3 + Math.random() * 0.25 });
      }
    }
    // 위로 솟구쳤다가 떨어지는 빛 알갱이 (도착·당첨)
    burst(x, y, color, n, power) {
      power = power || 1;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = (6 + Math.random() * 12) * power;
        this.add({ k: 'dot', x: x + (Math.random() - 0.5) * 0.6, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color: Math.random() < 0.25 ? '#FFFFFF' : color, r: 0.06 + Math.random() * 0.1, life: 0.7 + Math.random() * 0.7 });
      }
    }
    // 사방으로 터지는 불꽃놀이 (당첨)
    firework(x, y) {
      const c = PALETTE[(Math.random() * PALETTE.length) | 0];
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * TAU + Math.random() * 0.1, s = 9 + Math.random() * 3;
        this.add({ k: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color: i % 3 ? c : '#FFFFFF', r: 0.09, life: 1.1 + Math.random() * 0.4, drag: 2.2, g: 5 });
      }
    }
    confetti(x, y, n) {
      for (let i = 0; i < (n || 50); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 7 + Math.random() * 9;
        this.add({
          k: 'confetti', x: x + (Math.random() - 0.5) * 2, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, color: PALETTE[(Math.random() * PALETTE.length) | 0], life: 2.2 + Math.random() * 0.8,
        });
      }
    }
    pulse(x, color, big) { this.add({ k: 'pulse', x, color, big: big ? 1.8 : 1, life: 0.9 }); }
    laser(x) { this.add({ k: 'laser', x, life: 0.7 }); }
    pillar(x, color, big) { this.add({ k: 'pillar', x, color, big: big ? 1.6 : 1, life: big ? 1.6 : 1.1 }); }
    flare(x, y, color) { this.add({ k: 'flare', x, y, color, life: 0.28 }); }
    // 'n등': 가까운 곳에 막 뜬 것이 있으면 한 줄 위에 (여럿이 한꺼번에 들어와도 겹치지 않게)
    badge(x, text, color) {
      let lift = 0;
      while (lift < 3 && this.list.some(e => e.k === 'badge' && e.lift === lift && e.age < 0.8 && Math.abs(e.x - x) < 3.2)) lift++;
      this.add({ k: 'badge', x, text, color, lift, life: 1.3 });
    }
    float(x, label, color) { this.add({ k: 'float', x, label, color, life: 1.9 }); }
    kick(x, y) { this.kicks.push({ x, y, age: 0 }); }
    light(i) { this.lit.set(i, 1); }
    screen(color, a) { this.flashColor = color || '#FFFFFF'; this.flash = Math.max(this.flash, a || 0.6); }
    update(dt) {
      for (const e of this.list) {
        e.age += dt;
        if (e.k === 'shard') { e.vy += 14 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.rot += dt * 8; }
        else if (e.k === 'spark') { e.vx *= 1 - 3 * dt; e.vy *= 1 - 3 * dt; e.x += e.vx * dt; e.y += e.vy * dt; }
        else if (e.k === 'dot') { const d = e.drag || 1.4; e.vy += (e.g === undefined ? 16 : e.g) * dt; e.vx *= 1 - d * dt; e.vy *= 1 - d * dt; e.x += e.vx * dt; e.y += e.vy * dt; }
        else if (e.k === 'confetti') { e.vy += 9 * dt; e.vx *= 1 - 1.2 * dt; e.vy *= 1 - 1.2 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt; }
      }
      this.list = this.list.filter(e => e.age < e.life);
      for (const k of this.kicks) k.age += dt;
      this.kicks = this.kicks.filter(k => k.age < 0.3);
      for (const [i, v] of this.lit) { const n = v - dt * 3.2; if (n <= 0) this.lit.delete(i); else this.lit.set(i, n); }
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.flash = Math.max(0, this.flash - dt * 2.2);
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
      // 빛나는 것은 더해서 그린다
      ctx.globalCompositeOperation = 'lighter';
      for (const e of this.list) {
        const p = e.age / e.life;
        if (e.k === 'spark') {
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1, 0.08 * k);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(T.x(e.x), T.y(e.y)); ctx.lineTo(T.x(e.x - e.vx * 0.045), T.y(e.y - e.vy * 0.045)); ctx.stroke();
        } else if (e.k === 'dot') {
          const a0 = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3, r = Math.max(1, e.r * k);
          ctx.fillStyle = e.color;
          ctx.globalAlpha = a0 * 0.25;
          ctx.beginPath(); ctx.arc(T.x(e.x), T.y(e.y), r * 2.2, 0, TAU); ctx.fill();
          ctx.globalAlpha = a0;
          ctx.beginPath(); ctx.arc(T.x(e.x), T.y(e.y), r, 0, TAU); ctx.fill();
        } else if (e.k === 'ring') {
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1, 0.14 * k);
          ctx.beginPath(); ctx.arc(T.x(e.x), T.y(e.y), (0.3 + e.r1 * p) * k, 0, TAU); ctx.stroke();
        } else if (e.k === 'pulse') {
          ctx.globalAlpha = (1 - p) * 0.9;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, 0.2 * k * (1 - p));
          const rx = (0.6 + 6 * e.big * p) * k, ry = (0.3 + 1.2 * e.big * p) * k;
          ctx.beginPath(); ctx.ellipse(T.x(e.x), T.y(F), rx, ry, 0, 0, TAU); ctx.stroke();
        } else if (e.k === 'laser' || e.k === 'flare') {
          const big = e.k === 'laser';
          ctx.globalAlpha = 1 - p;
          const gx = T.x(e.x), gy = T.y(big ? F : e.y), r = (big ? 0.7 + 1.8 * p : 0.35 + 0.6 * p) * k;
          ctx.drawImage(glowSprite(big ? COL.laser : e.color), gx - r, gy - r, r * 2, r * 2);
        } else if (e.k === 'pillar') {
          // 결승선에서 솟는 빛기둥: 처음엔 가늘고 밝게, 퍼지면서 사라진다
          const a = p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88;
          const wpx = (0.5 + 1.4 * Math.min(1, p * 2.5)) * e.big * k, hpx = (8 + 4 * e.big) * k;
          const x = T.x(e.x), y = T.y(F);
          const g = ctx.createLinearGradient(0, y - hpx, 0, y);
          g.addColorStop(0, alpha(e.color, 0)); g.addColorStop(0.7, alpha(e.color, 0.35 * a)); g.addColorStop(1, alpha(e.color, 0.9 * a));
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.fillRect(x - wpx / 2, y - hpx, wpx, hpx);
          ctx.fillStyle = alpha('#FFFFFF', 0.8 * a);
          ctx.fillRect(x - wpx * 0.12, y - hpx * 0.8, wpx * 0.24, hpx * 0.8);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const e of this.list) {
        const p = e.age / e.life;
        if (e.k === 'shard') {
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = e.color;
          ctx.save(); ctx.translate(T.x(e.x), T.y(e.y)); ctx.rotate(e.rot);
          ctx.fillRect(-0.12 * k, -0.07 * k, 0.24 * k, 0.14 * k);
          ctx.restore();
        } else if (e.k === 'confetti') {
          ctx.globalAlpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
          ctx.fillStyle = e.color;
          ctx.save(); ctx.translate(T.x(e.x), T.y(e.y)); ctx.rotate(e.rot);
          ctx.fillRect(-0.16 * k, -0.07 * k, 0.32 * k * Math.abs(Math.cos(e.rot * 1.7)) + 1, 0.14 * k);
          ctx.restore();
        } else if (e.k === 'float' || e.k === 'badge') {
          // float: 확정된 칸 이름이 떠오름 / badge: 'n등'이 튀어 올랐다가 사라짐
          const badge = e.k === 'badge';
          ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          const pop = badge ? 1 + 0.6 * Math.max(0, 1 - p * 6) : 1;
          const size = Math.max(badge ? 13 : 14, (badge ? 0.95 : 1.2) * k) * pop;
          ctx.font = `${size}px ${STACK()}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          // 결승선 바로 위에서 조금만 떠오른다 (결승선 카메라 띠 안에 들어오게)
          const y = T.y(F - (badge ? 0.9 + p * 0.8 + e.lift * 0.95 : 1.0 + p * 1.8));
          ctx.strokeStyle = COL.void; ctx.lineWidth = Math.max(3, size * 0.16);
          ctx.strokeText(badge ? e.text : e.label, T.x(e.x), y);
          ctx.fillStyle = badge ? '#FFFFFF' : e.color;
          ctx.fillText(badge ? e.text : e.label, T.x(e.x), y);
          if (badge) { ctx.fillStyle = alpha(e.color, 0.55); ctx.fillText(e.text, T.x(e.x), y); }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 스프라이트 ----------
  const sprites1 = new Map();
  function cached(key, make) {
    let s = sprites1.get(key);
    if (!s) { if (sprites1.size > 400) sprites1.clear(); s = make(); sprites1.set(key, s); }
    return s;
  }
  function canvasOf(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }
  // 둥근 빛 (가운데 흰빛 → 색 → 투명), 64px 하나를 늘려 쓴다
  function glowSprite(color) {
    return cached('glow|' + color, () => {
      const cv = canvasOf(64, 64), g = cv.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.25, alpha(color, 0.75)); gr.addColorStop(1, alpha(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return cv;
    });
  }
  // 핀: 구간 색으로 빛나는 금속 구
  function pinSprite(rpx, glow) {
    const r = Math.max(1.5, Math.round(rpx * 2) / 2);
    return cached('pin|' + r + '|' + glow, () => {
      const gl = Math.max(3, r * 1.5), s = Math.ceil((r + gl) * 2 + 2), cv = canvasOf(s, s), g = cv.getContext('2d'), c = s / 2;
      const halo = g.createRadialGradient(c, c, r * 0.5, c, c, r + gl);
      halo.addColorStop(0, alpha(glow, 0.5)); halo.addColorStop(1, alpha(glow, 0));
      g.fillStyle = halo; g.beginPath(); g.arc(c, c, r + gl, 0, TAU); g.fill();
      const ball = g.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
      ball.addColorStop(0, '#FFFFFF'); ball.addColorStop(0.45, lighten(glow, 0.55)); ball.addColorStop(1, mix(glow, '#2A2350', 0.35));
      g.fillStyle = ball; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
      return cv;
    });
  }
  // 1등 왕관
  function crownSprite(px) {
    const s = Math.max(10, Math.round(px));
    return cached('crown|' + s, () => {
      const pad = s * 0.5, cv = canvasOf(s + pad * 2, s * 0.8 + pad * 2), g = cv.getContext('2d');
      g.translate(pad, pad);
      g.shadowColor = COL.amber; g.shadowBlur = s * 0.45;
      g.beginPath();
      g.moveTo(0, s * 0.8); g.lineTo(s * 0.06, s * 0.22); g.lineTo(s * 0.3, s * 0.5); g.lineTo(s * 0.5, 0);
      g.lineTo(s * 0.7, s * 0.5); g.lineTo(s * 0.94, s * 0.22); g.lineTo(s, s * 0.8); g.closePath();
      g.fillStyle = COL.amber; g.fill();
      g.shadowBlur = 0;
      g.lineWidth = Math.max(1.5, s * 0.08); g.strokeStyle = '#5A3A08'; g.lineJoin = 'round'; g.stroke();
      g.fillStyle = '#FFF4D6';
      for (const [x, y] of [[0.06, 0.22], [0.5, 0], [0.94, 0.22]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.08, 0, TAU); g.fill(); }
      return { cv, pad };
    });
  }

  // ---------- 그리기 ----------
  /* scene: {
   *   map, view, clock(초, 장식 애니메이션), now(게임 시각 — 칸 번쩍임 기준),
   *   mills:[{el, angle}], movers:[{el, x, y, a}], obstacles, colorOf(owner),
   *   names:[{id, text, color, x, y, a, shape?, fontM, w, ghost, me}], trails:[{color, pts}], leader(id),
   *   segs:[{label, w, closed, owner, closedAt}], blind, special(Set),
   *   finishAt(결승선을 그릴 y — 폰 대기실에서 긴 코스를 줄여 보여줄 때), cut:{y0, y1, text},
   *   showZone, showStart, showMillRange, halo, ghost, guide, fx, countdown:{n, f}, noOutside(전체 지도의 단)
   * } */
  function drawScene(ctx, T, sc) {
    const k = T.k, W = C.W, map = sc.map, F = map.F;
    const FB = sc.finishAt === undefined ? F : sc.finishAt;
    const v = sc.view || map.view;
    const vy0 = v.y0 - 3, vy1 = sc.cut ? Math.min(v.y1 + 3, sc.cut.y0) : v.y1 + 3;
    const vis = (a, b) => b >= vy0 && a <= vy1;
    const clock = sc.clock || 0;
    if (!sc.keepBudget) spriteBudget = 4;   // 한 프레임에 여러 번 그릴 때(결승선 띠, 전체 지도의 단)는 첫 번째에서만 채운다

    // 1. 바깥 배경 + 옆 장식
    if (!sc.noOutside) {
      ctx.fillStyle = COL.void;
      ctx.fillRect(T.x(v.x0) - 4000, T.y(v.y0) - 4000, (v.x1 - v.x0) * k + 8000, (v.y1 - v.y0) * k + 8000);
      drawSides(ctx, T, v, map, clock);
    }

    // 2. 플레이필드: 구간별 바탕(그림) + 구간 경계와 제목
    const top = Math.max(-16, v.y0 - 1), floor = Math.max(F, FB) + C.LABEL_BAND;
    let anyImg = false;
    map.stages.forEach((s, i) => {
      const a = Math.max(s.y0, top), b = Math.min(s.y1, floor, vy1);
      if (b <= a || !vis(a, b)) return;
      if (drawStageBg(ctx, T, map, s, i, a, b, floor)) anyImg = true;
    });
    // 바닥 그림 위를 살짝 눌러서 네온이 도드라지게
    ctx.fillStyle = 'rgba(6,4,13,0.22)';
    ctx.fillRect(T.x(0), T.y(Math.max(top, vy0)), W * k, (Math.min(floor, vy1) - Math.max(top, vy0)) * k);
    if (!anyImg && k > 4) {
      ctx.fillStyle = 'rgba(164,156,196,0.14)';
      const ds = Math.max(1, 0.06 * k);
      for (let y = Math.ceil(Math.max(top, vy0) / 1.5) * 1.5; y < Math.min(F, vy1); y += 1.5) {
        for (let x = 1.5; x < W; x += 1.5) ctx.fillRect(T.x(x) - ds / 2, T.y(y) - ds / 2, ds, ds);
      }
    }
    // 길 바깥 바위 (긴 코스)
    if (map.path) drawRocks(ctx, T, map, vy0, vy1);
    if (map.stages.length > 1) {
      map.stages.forEach((s, i) => {
        if (i === 0 || !vis(s.y0 - 1, s.y0 + 4) || (sc.cut && s.y0 > sc.cut.y0)) return;
        const th = themeOf(i), open = Sim.openAt ? Sim.openAt(map, s.y0 + 1.5)[0] : [0, W];
        ctx.strokeStyle = alpha(th.glow, 0.45);
        ctx.lineWidth = Math.max(1, 0.06 * k);
        ctx.setLineDash([0.5 * k, 0.4 * k]);
        const lineOpen = Sim.openAt ? Sim.openAt(map, s.y0)[0] : [0, W];
        ctx.beginPath(); ctx.moveTo(T.x(lineOpen[0] + 0.3), T.y(s.y0)); ctx.lineTo(T.x(lineOpen[1] - 0.3), T.y(s.y0)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `${Math.max(14, 1.7 * k)}px ${STACK()}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = alpha(th.glow, 0.3);
        ctx.fillText(String(i + 1).padStart(2, '0') + '  ' + s.name, T.x(open[0] + 1.1), T.y(s.y0 + 0.7));
        ctx.globalCompositeOperation = 'source-over';
      });
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
        if (el.kind === 'wall' || el.kind === 'rim' || !elVisible(el, vy0, vy1)) continue;
        if (el.a) {
          ctx.lineWidth = (el.r + C.CLEAR_MAP) * 2 * k;
          ctx.beginPath(); ctx.moveTo(T.x(el.a[0]), T.y(el.a[1])); ctx.lineTo(T.x(el.b[0]), T.y(el.b[1])); ctx.stroke();
        } else {
          const r = el.kind === 'mill' || el.kind === 'pendulum' ? el.len + el.thick : el.r || 1;
          ctx.beginPath(); ctx.arc(T.x(el.c[0]), T.y(el.c[1]), (r + C.CLEAR_MAP) * k, 0, TAU); ctx.fill();
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

    // 4. 맵 요소: 네온관(벽·경사판) → 핀 → 범퍼
    const lit = sc.fx ? sc.fx.lit : null;
    for (let i = 0; i < map.els.length; i++) {
      const el = map.els[i];
      if ((el.kind !== 'wall' && el.kind !== 'deflector' && el.kind !== 'rim') || !elVisible(el, vy0, vy1)) continue;
      if (el.kind === 'wall' || el.kind === 'rim') drawWall(ctx, T, el, map, vy0, vy1);
      else neon(ctx, T, el.a, el.b, el.r, stageTheme(map, (el.a[1] + el.b[1]) / 2).glow);
    }
    for (let i = 0; i < map.els.length; i++) {
      const el = map.els[i];
      if (el.kind === 'pin') {
        if (!elVisible(el, vy0, vy1)) continue;
        const glow = stageTheme(map, el.c[1]).glow, x = T.x(el.c[0]), y = T.y(el.c[1]);
        const sp = pinSprite(el.r * k, glow);
        ctx.drawImage(sp, x - sp.width / 2, y - sp.height / 2);
        const L = lit ? lit.get(i) : 0;
        if (L) {
          // 맞은 핀은 하얗게 번쩍인다
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(1, L);
          const r = (el.r * 4.5 + 0.6 * L) * k;
          ctx.drawImage(glowSprite(glow), x - r, y - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (el.kind === 'bumper') {
        if (!elVisible(el, vy0, vy1)) continue;
        const kick = sc.fx ? sc.fx.kickNear(el.c, el.r) : 0, idle = 0.5 + 0.5 * Math.sin(clock * 3 + el.c[0] + el.c[1]);
        const x = T.x(el.c[0]), y = T.y(el.c[1]), r = el.r * (1 + 0.22 * kick) * k;
        const mg = stageTheme(map, el.c[1]).glow === COL.amber ? COL.magenta : '#F06BD0';
        ctx.globalCompositeOperation = 'lighter';
        const gr = (el.r + 0.9 + 0.5 * kick) * k;
        ctx.globalAlpha = 0.35 + 0.25 * idle + 0.4 * kick;
        ctx.drawImage(glowSprite(mg), x - gr, y - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#2A0F33';
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = kick > 0 ? lighten(mg, 0.4 + 0.5 * kick) : lighten(mg, 0.15);
        ctx.lineWidth = Math.max(2, 0.22 * k);
        ctx.beginPath(); ctx.arc(x, y, r - 0.11 * k, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = Math.max(1, 0.06 * k);
        ctx.stroke();
        ctx.fillStyle = lighten(mg, 0.3 + 0.4 * idle);
        ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, TAU); ctx.fill();
      }
    }
    for (const m of sc.mills || []) {
      const el = m.el;
      if (!vis(el.c[1] - el.len - 1, el.c[1] + el.len + 1)) continue;
      const glow = stageTheme(map, el.c[1]).glow;
      const x = T.x(el.c[0]), y = T.y(el.c[1]);
      if (sc.showMillRange) {
        ctx.strokeStyle = 'rgba(201,206,221,0.16)';
        ctx.lineWidth = Math.max(1, 0.05 * k);
        ctx.beginPath(); ctx.arc(x, y, (el.len + el.thick / 2) * k, 0, TAU); ctx.stroke();
      }
      const ca = Math.cos(m.angle), sa = Math.sin(m.angle), L = el.len;
      neon(ctx, T, [el.c[0] - ca * L, el.c[1] - sa * L], [el.c[0] + ca * L, el.c[1] + sa * L], el.thick / 2, glow, 'butt');
      neon(ctx, T, [el.c[0] + sa * L, el.c[1] - ca * L], [el.c[0] - sa * L, el.c[1] + ca * L], el.thick / 2, glow, 'butt');
      hub(ctx, x, y, Math.max(2, 0.4 * k));
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

    // 7. 꼬리 + 이름 + 1등 왕관
    if (sc.trails) drawTrails(ctx, T, sc.trails);
    let lead = null;
    for (const n of sc.names || []) {
      if (n.y - 3 <= v.y1 + 3 && n.y + 3 >= vy0) { drawName(ctx, T, n); if (n.id === sc.leader) lead = n; }
    }
    if (lead) {
      const cs = crownSprite(Math.max(12, Math.min(34, 0.62 * k)));
      const x = T.x(lead.x), y = T.y(lead.y - Math.max(lead.h || 1, 1) * 0.55 - 0.25) - cs.cv.height + cs.pad + 2 + Math.sin(clock * 5) * 2;
      ctx.drawImage(cs.cv, x - cs.cv.width / 2, y);
    }

    // 8. 이펙트
    if (sc.fx) sc.fx.draw(ctx, T, FB);

    if (sc.countdown) drawCountdown(ctx, T, v, sc.countdown);
  }

  // 구간 바닥 그림: 보드 폭(30m)에 맞추고, 구간이 그림보다 꽤 길면(1구간) 세로로 이어 붙인다(위아래가 이어지게 만든 그림).
  // 아니면 한 장을 구간 높이에 맞춰 늘린다. 그림이 없으면 테마 그라디언트만
  function drawStageBg(ctx, T, map, s, i, a, b, floor) {
    const k = T.k, W = C.W, th = themeOf(map.stages.length > 1 ? i : 0);
    const g = ctx.createLinearGradient(0, T.y(Math.max(s.y0, -6)), 0, T.y(Math.min(s.y1, map.F)));
    g.addColorStop(0, th.bg2); g.addColorStop(1, th.bg);
    ctx.fillStyle = g;
    ctx.fillRect(T.x(0), T.y(a), W * k, (b - a) * k);
    const img = Assets.img['stage' + (i + 1)];
    if (!img || !img.width) return false;
    const sy0 = s.y0, sy1 = Math.min(s.y1, floor), H = sy1 - sy0;
    const tH = W * img.height / img.width;
    ctx.save();
    ctx.beginPath(); ctx.rect(T.x(0), T.y(a), W * k, (b - a) * k); ctx.clip();
    if (H > tH * 1.25) {
      for (let y = sy0 + Math.floor((a - sy0) / tH) * tH; y < b; y += tH) ctx.drawImage(img, T.x(0), T.y(y), W * k, tH * k);
    } else {
      const f = Math.max(1, H / tH), dw = W * f;
      ctx.drawImage(img, T.x((W - dw) / 2), T.y(sy0), dw * k, tH * f * k);
    }
    ctx.restore();
    return true;
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

  // 네온관: 넓고 옅은 빛 두 겹(더하기) + 색 관 + 흰 심
  function neon(ctx, T, a, b, r, glow, cap) {
    const k = T.k;
    ctx.lineCap = cap || 'round';
    ctx.beginPath(); ctx.moveTo(T.x(a[0]), T.y(a[1])); ctx.lineTo(T.x(b[0]), T.y(b[1]));
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alpha(glow, 0.13);
    ctx.lineWidth = Math.max(7, (r * 2 + 0.85) * k); ctx.stroke();
    ctx.strokeStyle = alpha(glow, 0.3);
    ctx.lineWidth = Math.max(4, (r * 2 + 0.3) * k); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = lighten(glow, 0.35);
    ctx.lineWidth = Math.max(2, r * 2 * k); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1, r * 0.75 * k); ctx.stroke();
    ctx.lineCap = 'round';
  }
  function hub(ctx, x, y, r) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite(COL.amber), x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COL.amber;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FFF4D6';
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.fill();
  }
  // 바위: 길 바깥과 섬. 어두운 바탕 + 옆판 그림을 옅게(월드에 고정해 이어 붙임) + 가장자리 안쪽 그림자. 네온 벽은 그 위에 그린다
  function drawRocks(ctx, T, map, vy0, vy1) {
    const k = T.k, img = Assets.img.side;
    for (const poly of map.path.rocks) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      if (y1 < vy0 || y0 > vy1) continue;
      ctx.save();
      ctx.beginPath();
      poly.forEach((p, i) => { if (i) ctx.lineTo(T.x(p[0]), T.y(p[1])); else ctx.moveTo(T.x(p[0]), T.y(p[1])); });
      ctx.closePath();
      ctx.fillStyle = '#08060F';
      ctx.fill();
      ctx.clip();
      if (img && img.width) {
        const tw = 6 * k, th = img.height * tw / img.width, ya = T.y(Math.max(y0, vy0)), yb = T.y(Math.min(y1, vy1));
        const sy = ya - (((ya - T.y(0)) % th) + th) % th;
        ctx.globalAlpha = 0.42;
        for (let x = T.x(x0); x < T.x(x1); x += tw) for (let y = sy; y < yb; y += th) ctx.drawImage(img, x, y, tw, th);
        ctx.globalAlpha = 1;
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.8 * k;
      ctx.stroke();
      ctx.restore();
    }
  }
  // 옆벽은 구간마다 네온 색이 바뀐다
  function drawWall(ctx, T, el, map, y0, y1) {
    if (el.frame && map.path) return;
    if (el.a[0] !== el.b[0] || map.stages.length < 2) { neon(ctx, T, el.a, el.b, el.r, stageTheme(map, (el.a[1] + el.b[1]) / 2).glow); return; }
    const lo = Math.min(el.a[1], el.b[1]), hi = Math.max(el.a[1], el.b[1]);
    map.stages.forEach((s, i) => {
      const a = Math.max(lo, s.y0, y0), b = Math.min(hi, s.y1, y1);
      if (b > a) neon(ctx, T, [el.a[0], a], [el.a[0], b], el.r, themeOf(i).glow, 'butt');
    });
  }

  function drawMover(ctx, T, m, map, vis) {
    const el = m.el, k = T.k, glow = stageTheme(map, el.c[1]).glow;
    if (el.kind === 'pendulum') {
      if (!vis(el.c[1] - 1, el.c[1] + el.len + 1)) return;
      const sx = -Math.sin(m.a) * el.len, sy = Math.cos(m.a) * el.len;
      neon(ctx, T, [m.x, m.y], [m.x + sx, m.y + sy], el.thick / 2, glow);
      hub(ctx, T.x(m.x), T.y(m.y), Math.max(3, 0.55 * k));
    } else if (el.kind === 'slider') {
      if (!vis(el.c[1] - 2, el.c[1] + 2)) return;
      // 오가는 길 표시
      ctx.setLineDash([0.3 * k, 0.3 * k]);
      ctx.strokeStyle = alpha(glow, 0.3);
      ctx.lineWidth = Math.max(1, 0.06 * k);
      ctx.beginPath(); ctx.moveTo(T.x(el.c[0] - el.amp - el.len / 2), T.y(el.c[1])); ctx.lineTo(T.x(el.c[0] + el.amp + el.len / 2), T.y(el.c[1])); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save(); ctx.translate(T.x(m.x), T.y(m.y)); ctx.rotate(m.a);
      const hw = el.len / 2 * k, hh = el.thick / 2 * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = alpha(glow, 0.22);
      roundRect(ctx, -hw - 0.35 * k, -hh - 0.35 * k, hw * 2 + 0.7 * k, hh * 2 + 0.7 * k, hh + 0.35 * k); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = lighten(glow, 0.35);
      roundRect(ctx, -hw, -hh, hw * 2, hh * 2, Math.min(hh, 0.12 * k)); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = COL.amber;
      for (let x = -hw; x < hw; x += 0.7 * k) { ctx.beginPath(); ctx.moveTo(x, hh); ctx.lineTo(x + 0.35 * k, -hh); ctx.lineTo(x + 0.6 * k, -hh); ctx.lineTo(x + 0.25 * k, hh); ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, 0.05 * k);
      roundRect(ctx, -hw, -hh, hw * 2, hh * 2, Math.min(hh, 0.12 * k)); ctx.stroke();
      ctx.restore();
    } else if (el.kind === 'disc') {
      if (!vis(el.c[1] - el.r - 1, el.c[1] + el.r + 1)) return;
      const x = T.x(m.x), y = T.y(m.y), r = el.r * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(glowSprite(glow), x - r * 1.7, y - r * 1.7, r * 3.4, r * 3.4);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const gr = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
      gr.addColorStop(0, '#2A1E12'); gr.addColorStop(1, '#4A3620');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = lighten(glow, 0.3); ctx.lineWidth = Math.max(2, 0.2 * k);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, 0.06 * k);
      ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(m.a);
      ctx.strokeStyle = alpha(glow, 0.85); ctx.lineWidth = Math.max(1.5, 0.13 * k);
      for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.moveTo(r * 0.2, 0); ctx.lineTo(r * 0.85, 0); ctx.stroke(); }
      ctx.restore();
      hub(ctx, x, y, Math.max(2, 0.3 * k));
    }
  }

  // 보드 바깥(좌우) 장식: 옆판 그림을 세로로 이어 붙이고(오른쪽은 좌우 반전), 레일과 깜박이는 조명
  function drawSides(ctx, T, v, map, clock) {
    const k = T.k, W = C.W;
    const lw = T.x(0) - T.x(v.x0), rw = T.x(v.x1) - T.x(W);
    const yTop = T.y(v.y0) - 50, yBot = T.y(v.y1) + 50;
    const img = Assets.img.side;
    if (img && (lw > 20 || rw > 20)) {
      const drawCol = (x, w, flip) => {
        if (w <= 4) return;
        const cw = Math.min(w, 260), th = img.height * (cw / img.width), off = ((T.oy * 0.6) % th + th) % th;
        ctx.save();
        ctx.beginPath(); ctx.rect(x, yTop, w, yBot - yTop); ctx.clip();
        ctx.globalAlpha = 0.85;
        // 판이 넓으면 보드 쪽에 붙여서 그린다
        const px = flip ? x : x + w - cw;
        if (flip) { ctx.translate(px + cw, 0); ctx.scale(-1, 1); }
        for (let y = yTop - off; y < yBot; y += th) ctx.drawImage(img, flip ? 0 : px, y, cw, th);
        ctx.restore();
      };
      drawCol(T.x(v.x0) - 1, lw - 0.3 * k, false);
      drawCol(T.x(W) + 0.3 * k, rw - 0.3 * k + 1, true);
    }
    // 2m마다 작은 조명, 시간에 따라 위에서 아래로 흐르듯 깜박임
    const rails = [-0.42, W + 0.42];
    for (const rx of rails) {
      if (T.x(rx) < -20 || T.x(rx) > T.w + 20) continue;
      ctx.globalCompositeOperation = 'lighter';
      for (let y = Math.ceil(v.y0 / 2) * 2; y < v.y1; y += 2) {
        const on = 0.25 + 0.75 * Math.max(0, Math.sin(clock * 4 - y * 0.35));
        ctx.fillStyle = alpha(stageTheme(map, y).glow, 0.18 + 0.6 * on);
        ctx.beginPath(); ctx.arc(T.x(rx), T.y(y), Math.max(1.2, 0.1 * k), 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawCut(ctx, T, cut, bottom) {
    const k = T.k, W = C.W, y0 = T.y(cut.y0), y1 = T.y(cut.y1);
    ctx.fillStyle = COL.void;
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
    ctx.globalCompositeOperation = 'lighter';
    for (const tr of trails) {
      const p = tr.pts, n = p.length;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        ctx.strokeStyle = alpha(tr.color, 0.42 * f);
        ctx.lineWidth = Math.max(1, (0.08 + 0.36 * f) * k);
        ctx.beginPath(); ctx.moveTo(T.x(p[i - 1][0]), T.y(p[i - 1][1])); ctx.lineTo(T.x(p[i][0]), T.y(p[i][1])); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawObstacle(ctx, T, o, edge, edgeScale) {
    const k = T.k, def = OBS[o.kind], fl = o.flash || 0;
    ctx.save();
    ctx.translate(T.x(o.x), T.y(o.y));
    ctx.lineJoin = 'round';
    if (def.shape === 'circle') {
      const r = def.r * k, a0 = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a0 * (0.5 + 0.5 * fl);
      ctx.drawImage(glowSprite(COL.magenta), -r * 2.2, -r * 2.2, r * 4.4, r * 4.4);
      ctx.globalAlpha = a0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = fl > 0 ? lighten(COL.magenta, fl * 0.6) : COL.magenta;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1.5, 0.12 * k * edgeScale);
      ctx.stroke();
      dots(ctx, o.hp, def.hp, 0, 0, k, COL.inkDeep);
    } else {
      ctx.rotate(o.a);
      const hw = def.len / 2 * k, hh = def.th / 2 * k;
      const base = o.kind === 'tramp' ? COL.teal : COL.brick;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = alpha(base, 0.18 + 0.3 * fl);
      roundRect(ctx, -hw - 0.3 * k, -hh - 0.3 * k, hw * 2 + 0.6 * k, hh * 2 + 0.6 * k, hh + 0.3 * k); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
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
      }
      ctx.fillStyle = fl > 0 ? lighten(base, fl * 0.6) : base;
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
      ctx.beginPath(); ctx.arc(x + (i - (max - 1) / 2) * gap, y, r, 0, TAU);
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

  // 레이저 결승선: 칸마다 빛나는 레이저, 칸막이, 칸 이름. 확정된 칸은 주인 색으로 번쩍이며 줄어든다
  function drawFinish(ctx, T, sc, F) {
    const k = T.k, B = C.LABEL_BAND, W = C.W, clock = sc.clock || 0;
    const g = ctx.createLinearGradient(0, T.y(F), 0, T.y(F + B));
    g.addColorStop(0, '#24091C'); g.addColorStop(0.35, '#12081A'); g.addColorStop(1, '#07040C');
    ctx.fillStyle = g;
    ctx.fillRect(T.x(0), T.y(F), W * k, B * k);
    const segs = sc.segs || [];
    let x = 0;
    const now = sc.now || 0;
    const bounds = segs.map(s => { const a = x; x += s.w; return [a, x]; });
    // 칸 바탕: 확정되는 칸은 주인 색으로 번쩍, 당첨 칸은 앰버로 숨 쉬듯
    segs.forEach((s, i) => {
      const [a, c] = bounds[i];
      if (c - a < 0.01) return;
      if (s.closed) {
        const fl = Math.max(0, 1 - (now - s.closedAt) / 1.2), col = sc.colorOf ? sc.colorOf(s.owner) : COL.amber;
        if (fl > 0) { ctx.fillStyle = alpha(col, 0.15 + 0.55 * fl); ctx.fillRect(T.x(a), T.y(F), (c - a) * k, B * k); }
      } else if (!sc.blind && sc.special && sc.special.has(s.label)) {
        ctx.fillStyle = alpha(COL.amber, 0.1 + 0.08 * Math.sin(clock * 4 + i));
        ctx.fillRect(T.x(a), T.y(F), (c - a) * k, B * k);
      }
    });
    // 레이저 선. 넓고 옅은 빛을 더하고 그 위에 밝은 심
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
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = alpha(color, 0.16);
      ctx.lineWidth = Math.max(10, (lw + 0.9) * k); ctx.stroke();
      ctx.strokeStyle = alpha(color, 0.35);
      ctx.lineWidth = Math.max(5, (lw + 0.3) * k); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, lw * k); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,235,240,0.9)';
      ctx.lineWidth = Math.max(1, lw * 0.35 * k); ctx.stroke();
    });
    // 레이저를 따라 흐르는 빛 두 점
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 2; j++) {
      const gx = ((clock * 9 + j * W / 2) % (W + 4)) - 2, r = 0.9 * k;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(glowSprite(COL.laser), T.x(gx) - r * 1.6, T.y(F) - r * 0.6, r * 3.2, r * 1.2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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

  function drawCountdown(ctx, T, v, cd) {
    const { n, f } = cd;
    const cx = (T.x(v.x0) + T.x(v.x1)) / 2, cy = (T.y(v.y0) + T.y(v.y1)) / 2;
    const text = n > 0 ? String(n) : '출발!';
    const base = Math.max(60, Math.min(T.w, T.h) * (n > 0 ? 0.32 : 0.2));
    const s = 1.35 - 0.35 * (1 - Math.pow(1 - Math.min(1, f * 2.2), 3));
    // 퍼지는 고리
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alpha(n > 0 ? COL.amber : COL.teal, 0.7 * (1 - f));
    ctx.lineWidth = Math.max(3, base * 0.05 * (1 - f));
    ctx.beginPath(); ctx.arc(cx, cy, base * (0.55 + f * 0.9), 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.globalAlpha = 1 - 0.4 * f;
    ctx.font = `${base}px ${STACK()}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = n > 0 ? COL.amber : COL.teal; ctx.shadowBlur = base * 0.25;
    ctx.lineWidth = Math.max(4, base * 0.06); ctx.strokeStyle = COL.void;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = n > 0 ? COL.amber : COL.teal;
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 게임 중 이름은 매 프레임 회전된 글자를 새로 그리면 느리다(30명이면 프레임당 100ms 넘게 걸리기도 함).
  // 이름마다 한 번 비트맵으로 그려 두고(빛 번짐 포함) drawImage로 돌려 그린다. 확대 배율이 크게 바뀔 때만 다시 만든다.
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
    const pad = 0.45, bw = shape.bw || shape.w;
    const x0 = Math.min(shape.ox, -bw / 2) - pad, x1 = Math.max(shape.ox + shape.w, bw / 2) + pad;
    const y0 = Math.min(shape.oy - shape.fontM * 0.8, -shape.h / 2) - pad, y1 = Math.max(shape.oy + shape.fontM * 0.8, shape.h / 2) + pad;
    const cv = canvasOf((x1 - x0) * want, (y1 - y0) * want);
    const g = cv.getContext('2d');
    // 1) 색 빛 번짐: 1/4 해상도에서 흐리게 그려서 늘린다 (큰 글자를 그대로 흐리면 수십 ms 걸림)
    const q = Math.max(4, want / 4), gc = canvasOf((x1 - x0) * q, (y1 - y0) * q), gg = gc.getContext('2d');
    gg.translate(-x0 * q, -y0 * q);
    gg.shadowColor = alpha(color, 0.9); gg.shadowBlur = Math.max(2, 0.3 * q);
    root.Glyph.draw(gg, shape, q, color, color, Math.max(1, 0.2 * q));
    g.drawImage(gc, 0, 0, cv.width, cv.height);
    // 2) 또렷한 글자
    g.translate(-x0 * want, -y0 * want);
    root.Glyph.draw(g, shape, want, color, COL.void, Math.max(2, 0.11 * want));
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

  // 화면 가장자리를 어둡게 (깊이감)
  function drawVignette(ctx, w, h, strength) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength === undefined ? 0.55 : strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
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
      const cv = mm.cv = canvasOf((g.w + 8) * dpr, (g.h + 8) * dpr);
      const c = cv.getContext('2d');
      c.scale(dpr, dpr); c.translate(4, 4);
      const X = x => x * g.s, Y = y => (y - g.y0) * g.s;
      c.fillStyle = 'rgba(6,4,13,0.86)';
      roundRect(c, -4, -4, g.w + 8, g.h + 8, 6); c.fill();
      map.stages.forEach((s, i) => {
        const a = Math.max(s.y0, g.y0), b = Math.min(s.y1, map.F);
        if (b <= a) return;
        c.fillStyle = themeOf(map.stages.length > 1 ? i : 0).bg2;
        c.fillRect(0, Y(a), g.w, (b - a) * g.s);
        if (i > 0) { c.fillStyle = alpha(themeOf(i).glow, 0.6); c.fillRect(0, Y(s.y0), g.w, 1); }
      });
      if (map.path) {
        c.fillStyle = 'rgba(6,4,13,0.92)';
        for (const poly of map.path.rocks) {
          c.beginPath();
          poly.forEach((p, i) => { const px = X(Math.max(-0.2, Math.min(C.W + 0.2, p[0]))), py = Y(Math.max(g.y0, p[1])); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
          c.closePath(); c.fill();
        }
      }
      c.lineWidth = 1.2; c.lineCap = 'round';
      for (const el of map.els) {
        if (el.frame && map.path) continue;
        const col = stageTheme(map, el.c ? el.c[1] : (el.a[1] + el.b[1]) / 2).glow;
        c.strokeStyle = lighten(col, 0.25); c.fillStyle = lighten(col, 0.25);
        if (el.kind === 'wall' && el.a[1] === el.b[1]) continue;
        if (el.a) { c.beginPath(); c.moveTo(X(el.a[0]), Y(Math.max(el.a[1], g.y0))); c.lineTo(X(el.b[0]), Y(Math.max(el.b[1], g.y0))); c.stroke(); }
        else if (el.kind === 'pendulum') { c.beginPath(); c.moveTo(X(el.c[0]), Y(el.c[1])); c.lineTo(X(el.c[0]), Y(el.c[1] + el.len)); c.stroke(); }
        else if (el.kind === 'slider') { c.beginPath(); c.moveTo(X(el.c[0] - el.len / 2), Y(el.c[1])); c.lineTo(X(el.c[0] + el.len / 2), Y(el.c[1])); c.stroke(); }
        else if (el.kind === 'mill') { c.beginPath(); c.arc(X(el.c[0]), Y(el.c[1]), Math.max(1, el.len * g.s * 0.7), 0, TAU); c.stroke(); }
        else { c.beginPath(); c.arc(X(el.c[0]), Y(el.c[1]), Math.max(0.8, el.r * g.s), 0, TAU); c.fill(); }
      }
      c.fillStyle = COL.laser;
      c.fillRect(0, Y(map.F) - 1, g.w, 2.5);
      if (g.w >= 100 && map.stages.length > 1) {
        // 대기실처럼 미니맵이 넓으면 구간 이름을 띠 위쪽에
        c.font = '700 10px "IBM Plex Sans KR", sans-serif';
        c.textAlign = 'left'; c.textBaseline = 'top';
        map.stages.forEach((s, i) => {
          const y = Y(Math.max(s.y0, g.y0)) + 3, th = themeOf(i);
          c.fillStyle = 'rgba(6,4,13,0.6)';
          c.fillRect(2, y - 1, c.measureText(`${i + 1} ${s.name}`).width + 6, 13);
          c.fillStyle = lighten(th.glow, 0.35);
          c.fillText(`${i + 1} ${s.name}`, 5, y);
        });
      }
    }
    ctx.drawImage(mm.cv, g.x - 4, g.top - 4, g.w + 8, g.h + 8);
    const X = x => g.x + x * g.s, Y = y => g.top + (y - g.y0) * g.s;
    if (info.view) {
      const a = Math.max(info.view.y0, g.y0), b = Math.min(info.view.y1, g.y1);
      ctx.fillStyle = 'rgba(243,238,255,0.08)';
      ctx.fillRect(g.x - 2, Y(a), g.w + 4, Math.max(2, (b - a) * g.s));
      ctx.strokeStyle = 'rgba(243,238,255,0.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(g.x - 2, Y(a), g.w + 4, Math.max(2, (b - a) * g.s));
    }
    for (const n of info.names || []) {
      const r = n.lead ? 3.4 : 2.4;
      ctx.fillStyle = n.color;
      ctx.beginPath(); ctx.arc(X(Math.max(0, Math.min(C.W, n.x))), Y(Math.max(g.y0, Math.min(g.y1, n.y))), r, 0, TAU); ctx.fill();
      ctx.strokeStyle = n.lead ? '#FFFFFF' : COL.void; ctx.lineWidth = n.lead ? 1.5 : 1;
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
    // arg: 'confirm'이면 도착 순서(음이 조금씩 올라감)
    play(kind, arg) {
      if (!this.on || !this.ac || this.ac.state !== 'running') return;
      const now = performance.now();
      const gap = kind === 'pin' ? 70 : 40;
      if (now - (this.last[kind] || 0) < gap) return;
      this.last[kind] = now;
      try {
        if (kind === 'bump') this.tone(180, 90, 0.14, 'sine', 0.22);
        else if (kind === 'pin') this.tone(1600 + Math.random() * 500, 1200, 0.03, 'triangle', 0.025);
        else if (kind === 'hit') this.tone(900, 600, 0.05, 'square', 0.06);
        else if (kind === 'break') this.noise(0.22, 0.18);
        else if (kind === 'tramp') this.tone(260, 720, 0.18, 'triangle', 0.16);
        else if (kind === 'confirm') {
          const f = 880 * Math.pow(2, Math.min(24, (arg || 1) - 1) / 24);
          this.tone(f, f, 0.32, 'sine', 0.16); this.tone(f * 1.5, f * 1.5, 0.22, 'sine', 0.06, 0.04);
          this.noise(0.18, 0.04, true);
        } else if (kind === 'tick') this.tone(660, 660, 0.09, 'square', 0.07);
        else if (kind === 'go') { this.tone(990, 990, 0.3, 'square', 0.08); this.tone(1480, 1480, 0.35, 'square', 0.05, 0.08); }
        else if (kind === 'stage') { this.noise(0.45, 0.07, true); this.tone(330, 495, 0.25, 'triangle', 0.08, 0.05); }
        else if (kind === 'rush') { this.tone(220, 880, 0.6, 'sawtooth', 0.06); }
        else if (kind === 'win') [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.14, i * 0.09));
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
    COL, PALETTE, THEMES, LOBBY, cutText, specialLabels, themeOf, stageTheme, setupCanvas, makeT, drawScene, drawObstacle,
    drawMinimap, minimapGeom, drawVignette, Fx, Sound, Assets, toast, lighten, alpha,
  };
})(typeof self !== 'undefined' ? self : this);
