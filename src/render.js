/* 핀볼 사다리 — 보드 렌더링 (호스트·폰 공용) + 이펙트 + 사운드 */
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
    return { k, ox, oy, x: m => ox + m * k, y: m => oy + m * k, mx: px => (px - ox) / k, my: py => (py - oy) / k };
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

  // ---------- 이펙트 ----------
  class Fx {
    constructor() { this.list = []; this.kicks = []; }
    ring(x, y, color, r1) { this.list.push({ k: 'ring', x, y, color, r1: r1 || 1.4, life: 0.45, age: 0 }); }
    shards(x, y, color, n) {
      for (let i = 0; i < (n || 9); i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
        this.list.push({ k: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, rot: Math.random() * 6, color, life: 0.8, age: 0 });
      }
    }
    laser(x) { this.list.push({ k: 'laser', x, life: 0.7, age: 0 }); }
    float(x, label, color) { this.list.push({ k: 'float', x, label, color, life: 1.6, age: 0 }); }
    kick(x, y) { this.kicks.push({ x, y, age: 0 }); }
    update(dt) {
      for (const e of this.list) {
        e.age += dt;
        if (e.k === 'shard') { e.vy += 14 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.rot += dt * 8; }
      }
      this.list = this.list.filter(e => e.age < e.life);
      for (const k of this.kicks) k.age += dt;
      this.kicks = this.kicks.filter(k => k.age < 0.3);
    }
    // 맵 범퍼가 튕길 때 커지는 정도 (0~1)
    kickNear(c, r) {
      let v = 0;
      for (const k of this.kicks) if (Math.hypot(k.x - c[0], k.y - c[1]) < r + 1.5) v = Math.max(v, 1 - k.age / 0.3);
      return v;
    }
    draw(ctx, T) {
      const k = T.k;
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
        } else if (e.k === 'laser') {
          ctx.globalAlpha = 1 - p;
          const gx = T.x(e.x), gy = T.y(C.FINISH_Y), r = (0.6 + 1.6 * p) * k;
          const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
          gr.addColorStop(0, 'rgba(255,255,255,0.95)');
          gr.addColorStop(0.35, 'rgba(255,59,92,0.7)');
          gr.addColorStop(1, 'rgba(255,59,92,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
        } else if (e.k === 'float') {
          ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          ctx.fillStyle = e.color;
          ctx.font = `${Math.max(12, 0.9 * k)}px ${root.Glyph ? root.Glyph.STACK : 'sans-serif'}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.strokeStyle = COL.inkDeep; ctx.lineWidth = Math.max(2, 0.12 * k); ctx.lineJoin = 'round';
          const y = T.y(C.FINISH_Y - 0.8 - p * 3.2);
          ctx.strokeText(e.label, T.x(e.x), y);
          ctx.fillText(e.label, T.x(e.x), y);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 그리기 ----------
  /* scene: {
   *   map, mode, time, view(배경을 칠할 범위),
   *   mills:[{el, angle}], obstacles:[{id, owner, kind, x, y, a, hp, alive, flash}], colorOf(owner),
   *   names:[{id, text, color, x, y, a, shape?, fontM, ghost, me}],
   *   segs:[{label, w, closed, owner, closedAt}], blind, now(초 — 칸 번쩍임 기준),
   *   showZone, showStart, showMillRange, halo(금지 구역 후광), ghost:{kind,x,y,a,ok}, guide:{x,y},
   *   fx, countdown
   * } */
  function drawScene(ctx, T, sc) {
    const k = T.k, W = C.W, F = C.FINISH_Y;
    const v = sc.view || C.VIEW;
    spriteBudget = 6;

    // 1. 배경
    ctx.fillStyle = COL.inkDeep;
    ctx.fillRect(T.x(v.x0) - 4000, T.y(v.y0) - 4000, (v.x1 - v.x0) * k + 8000, (v.y1 - v.y0) * k + 8000);
    const top = Math.max(-16, v.y0 - 1);
    ctx.fillStyle = COL.ink;
    ctx.fillRect(T.x(0), T.y(top), W * k, (F + C.LABEL_BAND - top) * k);
    if (k > 4) {
      ctx.fillStyle = 'rgba(164,156,196,0.16)';
      const ds = Math.max(1, 0.06 * k);
      for (let y = Math.ceil(top / 1.5) * 1.5; y < F; y += 1.5) {
        for (let x = 1.5; x < W; x += 1.5) ctx.fillRect(T.x(x) - ds / 2, T.y(y) - ds / 2, ds, ds);
      }
    }

    // 2. 설치 구역
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
      for (const el of sc.map.els) {
        if (el.kind === 'wall') continue;
        if (el.kind === 'deflector') {
          ctx.strokeStyle = 'rgba(255,107,122,0.11)';
          ctx.lineCap = 'round';
          ctx.lineWidth = (el.r + C.CLEAR_MAP) * 2 * k;
          ctx.beginPath(); ctx.moveTo(T.x(el.a[0]), T.y(el.a[1])); ctx.lineTo(T.x(el.b[0]), T.y(el.b[1])); ctx.stroke();
        } else {
          const r = el.kind === 'mill' ? el.len + el.thick : el.r;
          ctx.beginPath(); ctx.arc(T.x(el.c[0]), T.y(el.c[1]), (r + C.CLEAR_MAP) * k, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // 3. 출발선
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
    for (const el of sc.map.els) {
      if (el.kind === 'wall' || el.kind === 'deflector') {
        ctx.strokeStyle = COL.chrome;
        ctx.lineWidth = Math.max(1.5, el.r * 2 * k);
        ctx.beginPath(); ctx.moveTo(T.x(el.a[0]), T.y(el.a[1])); ctx.lineTo(T.x(el.b[0]), T.y(el.b[1])); ctx.stroke();
      } else if (el.kind === 'pin') {
        const x = T.x(el.c[0]), y = T.y(el.c[1]), r = Math.max(1.5, el.r * k);
        ctx.fillStyle = COL.chrome;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
      } else if (el.kind === 'bumper') {
        const kick = sc.fx ? sc.fx.kickNear(el.c, el.r) : 0;
        const x = T.x(el.c[0]), y = T.y(el.c[1]), r = el.r * (1 + 0.22 * kick) * k;
        ctx.fillStyle = kick > 0 ? 'rgba(228,107,196,0.45)' : 'rgba(228,107,196,0.18)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = kick > 0 ? lighten(COL.magenta, 0.5 * kick) : COL.magenta;
        ctx.lineWidth = Math.max(2, 0.2 * k);
        ctx.beginPath(); ctx.arc(x, y, r - 0.1 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = COL.magenta;
        ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const m of sc.mills || []) {
      const el = m.el, x = T.x(el.c[0]), y = T.y(el.c[1]);
      if (sc.showMillRange) {
        ctx.strokeStyle = 'rgba(201,206,221,0.16)';
        ctx.lineWidth = Math.max(1, 0.05 * k);
        ctx.beginPath(); ctx.arc(x, y, (el.len + el.thick / 2) * k, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(m.angle);
      ctx.strokeStyle = COL.chrome;
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(2, el.thick * k);
      ctx.beginPath();
      ctx.moveTo(-el.len * k, 0); ctx.lineTo(el.len * k, 0);
      ctx.moveTo(0, -el.len * k); ctx.lineTo(0, el.len * k);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = COL.amber;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, 0.36 * k), 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'round';
    }

    // 5. 유저 장애물
    for (const o of sc.obstacles || []) {
      if (o.alive === false) continue;
      drawObstacle(ctx, T, o, sc.colorOf ? sc.colorOf(o.owner) : COL.chrome, 1);
    }
    if (sc.ghost) {
      ctx.globalAlpha = 0.6;
      drawObstacle(ctx, T, Object.assign({ hp: OBS[sc.ghost.kind].hp, flash: 0 }, sc.ghost), sc.ghost.ok ? COL.good : COL.bad, 1.6);
      ctx.globalAlpha = 1;
    }

    // 6. 레이저 결승선
    drawFinish(ctx, T, sc);

    // 출발 위치 가이드 (폰)
    if (sc.guide) {
      ctx.setLineDash([Math.max(3, 0.25 * k), Math.max(3, 0.22 * k)]);
      ctx.strokeStyle = 'rgba(255,181,71,0.8)';
      ctx.lineWidth = Math.max(1.5, 0.07 * k);
      ctx.beginPath(); ctx.moveTo(T.x(sc.guide.x), T.y(sc.guide.y + 0.6)); ctx.lineTo(T.x(sc.guide.x), T.y(F)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 7. 이름
    for (const n of sc.names || []) drawName(ctx, T, n);

    // 8. 이펙트
    if (sc.fx) sc.fx.draw(ctx, T);

    if (sc.countdown) {
      const cx = T.x(W / 2), cy = T.y(13);
      ctx.font = `${Math.max(60, 9 * k)}px ${root.Glyph ? root.Glyph.STACK : 'sans-serif'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(4, 0.5 * k); ctx.strokeStyle = COL.inkDeep; ctx.lineJoin = 'round';
      ctx.strokeText(String(sc.countdown), cx, cy);
      ctx.fillStyle = COL.amber;
      ctx.fillText(String(sc.countdown), cx, cy);
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

  function drawFinish(ctx, T, sc) {
    const k = T.k, F = C.FINISH_Y, B = C.LABEL_BAND, W = C.W;
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
    const fam = root.Glyph ? root.Glyph.STACK : 'sans-serif';
    segs.forEach((s, i) => {
      const [a, c] = bounds[i], w = c - a;
      if (w < 0.12) return;
      const label = s.closed || !sc.blind ? s.label : '?';
      let size = 0.85;
      ctx.font = `${size * k}px ${fam}`;
      let tw = ctx.measureText(label).width / k;
      if (tw > w - 0.12) {
        size = Math.max(0.34, size * (w - 0.12) / tw);
        ctx.font = `${size * k}px ${fam}`;
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(T.x(a) + 1, T.y(F), w * k - 2, B * k); ctx.clip();
      ctx.fillStyle = s.closed ? (sc.colorOf ? sc.colorOf(s.owner) : COL.amber) : COL.text;
      ctx.globalAlpha = s.closed ? Math.max(0.35, w / Math.max(0.5, s.w0 || w)) : 1;
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

  // ---------- 사운드 ----------
  const Sound = {
    ac: null, on: true, last: {},
    unlock() {
      try {
        if (!this.ac) { const AC = root.AudioContext || root.webkitAudioContext; if (AC) this.ac = new AC(); }
        if (this.ac && this.ac.state === 'suspended') this.ac.resume();
      } catch (e) { /* 소리 없이 진행 */ }
    },
    tone(f0, f1, dur, type, vol) {
      const a = this.ac, t = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol) {
      const a = this.ac, t = a.currentTime, n = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = a.createBufferSource(), g = a.createGain();
      s.buffer = buf; g.gain.value = vol;
      s.connect(g).connect(a.destination); s.start(t);
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

  root.Render = { COL, PALETTE, setupCanvas, makeT, drawScene, drawObstacle, Fx, Sound, toast, lighten };
})(typeof self !== 'undefined' ? self : this);
