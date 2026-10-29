/* 핀볼 사다리 — 이름 글자 → 물리 모양(볼록 다각형 여러 개)
 * 글자를 캔버스에 그려서 픽셀 덩어리(자모·글자 조각)를 찾고, 덩어리마다 볼록 껍질을 만든다.
 * 좌표는 글자 픽셀 bbox 중심 기준 미터 단위. 이 중심이 물리 바디의 원점이 된다.
 */
(function (root) {
  'use strict';
  const Sim = root.Sim, C = Sim.C;
  const S = 72;                      // 추출 해상도 px/m
  const STACK = '"Black Han Sans", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const MAX_PIECES = 24;
  const DROP_AREA = 0.004, MERGE_AREA = 0.025;   // m²

  // 굵기를 지정하지 않는다 (BHS는 400만 있어서 지정하면 가짜 볼드가 생김)
  const font = px => px.toFixed(2) + 'px ' + STACK;

  let mctx = null;
  function measureCtx() {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    return mctx;
  }
  function measure(text, fontM) {
    const ctx = measureCtx();
    ctx.font = font(fontM * S);
    return ctx.measureText(text).width / S;
  }

  // 폭이 NAME_MAX_W를 넘으면 NAME_MIN_FONT까지 글자를 줄인다
  function metrics(text) {
    let fontM = C.NAME_FONT, w = measure(text, fontM);
    if (w > C.NAME_MAX_W) {
      fontM = Math.max(C.NAME_MIN_FONT, fontM * C.NAME_MAX_W / w);
      w = measure(text, fontM);
    }
    return { fontM, w: Math.max(0.3, w), h: fontM };
  }

  // 한글 웹폰트는 글자 범위별로 쪼개져 있어서 text를 꼭 넘겨야 그 글자가 든 조각을 받는다
  function loadFont(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve(false);
    const p = document.fonts.load('72px "Black Han Sans"', text || '가A')
      .then(list => list.length > 0, () => false);
    return Promise.race([p, new Promise(r => setTimeout(() => r(false), 3000))]);
  }

  const cache = new Map();
  function trace(text) {
    const key = text + '\u0000' + (document.fonts && document.fonts.check ? document.fonts.check('72px "Black Han Sans"', text) : '');
    if (cache.has(key)) return cache.get(key);
    const m = metrics(text), fpx = m.fontM * S;
    const pad = Math.ceil(fpx * 0.6) + 6;
    const tw = Math.ceil(m.w * S);
    const cw = tw + pad * 2, ch = Math.ceil(fpx * 2) + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.font = font(fpx);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    const bx = pad, by = Math.round(ch / 2);
    g.fillText(text, bx, by);
    g.strokeText(text, bx, by);   // 살짝 부풀리기
    const data = g.getImageData(0, 0, cw, ch).data;

    // 1. 이진화
    const bin = new Uint8Array(cw * ch);
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let i = 0; i < bin.length; i++) {
      if (data[i * 4 + 3] > 110) {
        bin[i] = 1;
        const x = i % cw, y = (i / cw) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    let out;
    if (x1 < 0) {
      out = boxShape(text, m, bx, by, cw, ch);
    } else {
      const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
      const toM = (px, py) => [(px - cx) / S, (py - cy) / S];

      // 2. 8방향 연결 덩어리 — 덩어리마다 행별 양 끝 x만 기록
      const lab = new Int32Array(cw * ch);
      const comps = [];
      const stack = [];
      for (let i = 0; i < bin.length; i++) {
        if (!bin[i] || lab[i]) continue;
        const id = comps.length + 1, rows = new Map();
        let count = 0, sx = 0;
        lab[i] = id; stack.push(i);
        while (stack.length) {
          const j = stack.pop(), x = j % cw, y = (j / cw) | 0;
          count++; sx += x;
          const r = rows.get(y);
          if (!r) rows.set(y, [x, x]); else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= ch) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= cw) continue;
              const k = yy * cw + xx;
              if (bin[k] && !lab[k]) { lab[k] = id; stack.push(k); }
            }
          }
        }
        comps.push({ rows, area: count / (S * S), mx: sx / count });
      }

      // 3. 너무 작은 조각은 버리고, 작은 조각은 가장 가까운 덩어리와 합친다
      let pieces = comps.filter(c => c.area >= DROP_AREA).map(c => ({ pts: rowPoints(c.rows, toM), area: c.area, mx: c.mx }));
      pieces.sort((a, b) => a.area - b.area);
      for (let i = 0; i < pieces.length && pieces.length > 1;) {
        const p = pieces[i];
        if (p.area >= MERGE_AREA) { i++; continue; }
        let best = -1, bd = Infinity;
        pieces.forEach((q, j) => { if (j !== i) { const d = nearest(p.pts, q.pts); if (d < bd) { bd = d; best = j; } } });
        const q = pieces[best];
        q.pts = q.pts.concat(p.pts);
        q.mx = (q.mx * q.area + p.mx * p.area) / (q.area + p.area);
        q.area += p.area;
        pieces.splice(i, 1);
        pieces.sort((a, b) => a.area - b.area);
        i = 0;
      }

      // 4. 조각이 너무 많으면 글자 단위로 묶는다 (글자별 x범위는 앞부분 measureText로)
      if (pieces.length > MAX_PIECES) {
        const chars = Array.from(text), edges = [0];
        for (let i = 1; i <= chars.length; i++) edges.push(g.measureText(chars.slice(0, i).join('')).width);
        const groups = chars.map(() => []);
        for (const p of pieces) {
          const rx = p.mx - bx;
          let k = edges.findIndex((e, i) => i > 0 && rx < e) - 1;
          if (k < 0) k = rx < 0 ? 0 : chars.length - 1;
          groups[k].push(...p.pts);
        }
        pieces = groups.filter(gr => gr.length).map(pts => ({ pts }));
      }

      let polys = pieces.map(p => Sim.cleanPoly(p.pts, 8)).filter(Boolean);
      polys = polys.map(p => p.map(v => [round4(v[0]), round4(v[1])]));
      if (!polys.length) out = boxShape(text, m, bx, by, cw, ch, cx, cy);
      else {
        out = {
          text, fontM: m.fontM, w: m.w, h: (y1 - y0 + 1) / S,
          bw: (x1 - x0 + 1) / S, ox: (bx - cx) / S, oy: (by - cy) / S, polys,
        };
      }
    }
    cache.set(key, out);
    return out;
  }

  // 행마다 양 끝 픽셀의 바깥 모서리 점 4개
  function rowPoints(rows, toM) {
    const pts = [];
    for (const [y, r] of rows) {
      pts.push(toM(r[0], y), toM(r[0], y + 1), toM(r[1] + 1, y), toM(r[1] + 1, y + 1));
    }
    return pts;
  }
  function nearest(a, b) {
    // 두 점 집합의 대략적인 최소 거리 (점이 많으면 건너뛰며 샘플링)
    const sa = Math.max(1, Math.floor(a.length / 40)), sb = Math.max(1, Math.floor(b.length / 40));
    let d = Infinity;
    for (let i = 0; i < a.length; i += sa) for (let j = 0; j < b.length; j += sb) {
      const dx = a[i][0] - b[j][0], dy = a[i][1] - b[j][1], q = dx * dx + dy * dy;
      if (q < d) d = q;
    }
    return d;
  }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  function boxShape(text, m, bx, by, cw, ch, cx, cy) {
    const hw = m.w / 2, hh = m.fontM / 2;
    if (cx === undefined) { cx = bx + m.w * S / 2; cy = by; }
    return {
      text, fontM: m.fontM, w: m.w, h: m.fontM, bw: m.w, ox: (bx - cx) / S, oy: (by - cy) / S,
      polys: [[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]],
    };
  }

  // 그리기 규칙: translate(바디 위치) → rotate(각도) → fillText(text, ox, oy) (left / middle)
  function draw(ctx, shape, k, fill, ink, lineW) {
    ctx.font = font(shape.fontM * k);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineW;
    ctx.strokeStyle = ink;
    ctx.strokeText(shape.text, shape.ox * k, shape.oy * k);
    ctx.fillStyle = fill;
    ctx.fillText(shape.text, shape.ox * k, shape.oy * k);
  }

  root.Glyph = { S, STACK, font, metrics, measure, loadFont, trace, draw };
})(typeof self !== 'undefined' ? self : this);
