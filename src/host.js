/* 핀볼 사다리 — 호스트(PC) 화면: 설정 → 대기실 → 카운트다운 → 진행 → 결과
 * 물리는 여기서만 돈다. 폰은 입력만 보내고, 이름·출발 위치·장애물은 전부 여기서 다시 검증한다.
 */
(function (root) {
  'use strict';
  const Sim = root.Sim, C = Sim.C, Glyph = root.Glyph, Render = root.Render, Net = root.Net;
  const MAP = Sim.buildMap();
  const $ = id => document.getElementById(id);
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const store = kind => ({
    get(k) { try { return JSON.parse(root[kind].getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { root[kind].setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 안 됨 */ } },
    del(k) { try { root[kind].removeItem(k); } catch (e) { /* 무시 */ } },
  });
  const ss = store('sessionStorage'), ls = store('localStorage');
  const DEFAULT_LABELS = '커피 쏘기\n간식 쏘기\n꽝*4';
  const COUNT_SEC = 3;

  const st = {
    phase: 'setup',            // setup | lobby | countdown | running | done
    roomOpen: false,
    setup: { labels: DEFAULT_LABELS, obsPer: 2, blind: false },
    labels: [], labRev: 1,
    code: null, net: null,
    players: [], pseq: 1, kicked: [],
    obstacles: [], oseq: 1, obsRev: 1,
    game: null, parts: [], shapes: {}, results: [], lastResults: {}, runToken: 0,
    acc: 0, countStart: 0, lastCount: 0, doneAt: 0,
    follow: true, cam: null, fx: new Render.Fx(), T: null, panelDirty: true,
    startArmed: false, abortArmed: false, drag: null, stats: { frames: 0, slowFrames: 0, maxSteps: 0, stepMs: 0, steps: 0 },
  };

  // ---------- 칸 이름 ----------
  // 줄바꿈이나 쉼표로 구분. "꽝*3" 또는 "꽝×3" → 3칸. 최대 30칸, 라벨은 12자까지
  function parseLabels(text) {
    const out = [];
    for (let part of String(text || '').split(/[\n,]/)) {
      part = part.replace(/\s+/g, ' ').trim();
      if (!part) continue;
      let n = 1;
      const m = part.match(/^(.*?)\s*[*×]\s*(\d{1,3})$/);
      if (m && m[1].trim()) { part = m[1].trim(); n = Math.max(1, +m[2]); }
      part = Array.from(part).slice(0, 12).join('');
      for (let i = 0; i < n && out.length <= C.MAX_SEGMENTS; i++) out.push(part);
    }
    let err = '';
    if (!out.length) err = '칸 이름을 하나 이상 적어주세요';
    else if (out.length > C.MAX_SEGMENTS) err = `칸은 ${C.MAX_SEGMENTS}개까지예요`;
    return { labels: out.slice(0, C.MAX_SEGMENTS), err };
  }

  // ---------- 플레이어 ----------
  const named = () => st.players.filter(p => p.name);
  const byConn = conn => st.players.find(p => p.conn === conn);
  const byId = id => st.players.find(p => p.id === id);
  const colorOf = id => { const p = byId(id); return p ? p.color : Render.COL.chrome; };
  function freeColor() {
    const used = new Set(st.players.map(p => p.color));
    return Render.PALETTE.find(c => !used.has(c)) || Render.PALETTE[st.players.length % Render.PALETTE.length];
  }
  function normName(s) {
    // 제어 문자·폭 없는 문자·방향 제어 문자를 지운다
    const clean = Array.from(String(s || '')).filter(ch => {
      const c = ch.codePointAt(0);
      return !(c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || c === 0xfeff);
    }).join('');
    return clean.replace(/\s+/g, ' ').trim();
  }
  function checkName(name, self) {
    if (!name) return '이름을 적어주세요';
    if (Array.from(name).length > C.NAME_MAX_CHARS) return `이름은 ${C.NAME_MAX_CHARS}글자까지예요`;
    const low = name.toLowerCase();
    if (st.players.some(q => q !== self && q.name && q.name.toLowerCase() === low)) return '이미 있는 이름이에요';
    return '';
  }
  function measure(p) {
    const m = Glyph.metrics(p.name);
    p.w = m.w; p.fontM = m.fontM;
    p.x = Sim.clampDropX(p.x, p.w);
  }
  function setName(p, name) {
    const first = !p.name;
    p.name = name;
    if (first) p.x = C.W / 2;
    measure(p);
    if (first) p.x = Sim.clampDropX(p.w / 2 + 0.4 + Math.random() * (C.W - p.w - 0.8), p.w); // 모두 가운데에 쌓이는 것 방지
    Glyph.loadFont(name).then(() => { if (p.name === name) { measure(p); scheduleLobby(); } });
  }
  function layout() {
    return Sim.layoutStart(named().map(p => ({ id: p.id, x: p.x, w: p.w })));
  }
  const nObs = id => st.obstacles.reduce((n, o) => n + (o.owner === id), 0);
  function phonePhase() {
    return st.phase === 'countdown' || st.phase === 'running' ? 'running' : st.phase === 'done' ? 'done' : 'lobby';
  }
  function send(p, msg) { if (p && p.conn && st.net) st.net.send(p.conn, msg); }

  // ---------- 대기실 브로드캐스트 (초당 최대 5회) ----------
  // PeerJS json 채널은 16KB를 넘는 메시지를 버리므로 배열로 압축해서 보낸다 (30명 × 장애물 5개 ≈ 8KB)
  let lobbyTimer = null, lastLobby = 0;
  function scheduleLobby() {
    st.panelDirty = true;
    if (lobbyTimer) return;
    lobbyTimer = setTimeout(flushLobby, Math.max(0, 200 - (Date.now() - lastLobby)));
  }
  function lobbyBase() {
    return {
      t: 'lobby', obsPer: st.setup.obsPer,
      players: named().map(p => [p.id, p.name, p.color, r2(p.x), r2(p.w), r3(p.fontM),
        (p.ready || p.local ? 1 : 0) | (p.online || p.local ? 2 : 0) | (p.local ? 4 : 0), nObs(p.id)]),
    };
  }
  function lobbyFor(conn, base, full) {
    const msg = Object.assign({}, base);
    if (full || conn.obsRev !== st.obsRev) { msg.obstacles = st.obstacles.map(o => [o.id, o.kind, o.x, o.y, o.a]); conn.obsRev = st.obsRev; }
    if (full || conn.labRev !== st.labRev) { msg.labels = st.setup.blind ? st.labels.map(() => '?') : st.labels; conn.labRev = st.labRev; }
    return msg;
  }
  function flushLobby() {
    lobbyTimer = null;
    lastLobby = Date.now();
    saveRoom();
    if (!st.net) return;
    const base = lobbyBase();
    for (const p of st.players) if (p.conn && p.name) st.net.send(p.conn, lobbyFor(p.conn, base, false));
  }
  function sendLobby(p, full) { if (p.conn) st.net.send(p.conn, lobbyFor(p.conn, lobbyBase(), full)); }

  function welcome(p) {
    send(p, {
      t: 'welcome', id: p.id, name: p.name, color: p.color, x: p.x, ready: p.ready, phase: phonePhase(),
      obsPer: st.setup.obsPer, result: st.lastResults[p.id] || null, code: st.code, inGame: st.parts.includes(p.id),
    });
    if (p.name) sendLobby(p, true);
  }

  // ---------- 폰 메시지 ----------
  function onData(conn, m) {
    if (m.t === 'hello') return onHello(conn, m.cid);
    const p = byConn(conn);
    if (!p) return;
    if (!p.online) { p.online = true; scheduleLobby(); }
    const lobbyish = st.phase === 'lobby' || st.phase === 'setup';
    switch (m.t) {
      case 'name': {
        if (p.name && !lobbyish) { send(p, { t: 'name-bad', reason: '게임 중에는 이름을 바꿀 수 없어요' }); break; }
        const name = normName(m.name), err = checkName(name, p);
        if (err) { send(p, { t: 'name-bad', reason: err }); break; }
        setName(p, name);
        send(p, { t: 'name-ok', name, color: p.color });
        sendLobby(p, true);
        scheduleLobby();
        break;
      }
      case 'drop':
        if (!lobbyish || !p.name || !Number.isFinite(+m.x)) break;
        p.x = Sim.clampDropX(r2(+m.x), p.w);
        scheduleLobby();
        break;
      case 'obs': onObs(p, m); break;
      case 'ready':
        if (!lobbyish) break;
        p.ready = !!m.on;
        scheduleLobby();
        break;
    }
  }

  function onHello(conn, cid) {
    cid = String(cid || '').replace(/[^\w-]/g, '').slice(0, 40) || 'x' + Math.random().toString(36).slice(2, 10);
    if (st.kicked.includes(cid)) { st.net.send(conn, { t: 'kicked' }); st.net.drop(conn); return; }
    let p = st.players.find(q => q.cid === cid && !q.local);
    if (!p) {
      const active = st.players.filter(q => q.name || q.online).length;
      if (active >= C.MAX_PLAYERS) { st.net.send(conn, { t: 'full' }); st.net.drop(conn); return; }
      p = { id: 'p' + st.pseq++, cid, name: null, color: freeColor(), x: C.W / 2, w: 1, fontM: 1, ready: false, local: false, online: true, conn: null };
      st.players.push(p);
    }
    if (p.conn && p.conn !== conn) st.net.drop(p.conn);   // 같은 폰의 이전 연결
    p.conn = conn;
    p.online = true;
    welcome(p);
    scheduleLobby();
  }

  function onObs(p, m) {
    const lid = String(m.id || '').replace(/[^\w-]/g, '').slice(0, 12);
    const bad = reason => send(p, { t: 'obs-bad', id: lid, reason });
    if (st.phase !== 'lobby' && st.phase !== 'setup') return bad('지금은 장애물을 바꿀 수 없어요');
    if (!lid || !p.name) return bad('잘못된 요청이에요');
    const id = p.id + ':' + lid;   // 저장 id에 소유자를 넣어서 남의 장애물을 못 건드리게
    const cur = st.obstacles.find(o => o.id === id);
    if (m.op === 'del') {
      if (cur) { st.obstacles = st.obstacles.filter(o => o !== cur); st.obsRev++; scheduleLobby(); }
      send(p, { t: 'obs-ok', id: lid, op: 'del' });
      return;
    }
    if (m.op !== 'put') return;
    if (!Sim.OBS[m.kind]) return bad('잘못된 장애물이에요');
    if (!cur && nObs(p.id) >= st.setup.obsPer) return bad(st.setup.obsPer ? `장애물은 ${st.setup.obsPer}개까지예요` : '이번 판은 장애물이 없어요');
    const o = { id, owner: p.id, kind: m.kind, x: r2(+m.x), y: r2(+m.y), a: r3(Sim.normAngle(m.kind, +m.a || 0)) };
    const v = Sim.validateObstacle(MAP, st.obstacles, o);
    if (!v.ok) return bad(v.reason);
    if (cur) Object.assign(cur, o);
    else st.obstacles.push(Object.assign(o, { seq: st.oseq++ }));
    st.obsRev++;
    send(p, { t: 'obs-ok', id: lid, op: 'put' });
    scheduleLobby();
  }

  function kick(p) {
    if (!p.local) {
      send(p, { t: 'kicked' });
      if (p.conn) st.net.drop(p.conn);
      if (p.cid) st.kicked.push(p.cid);
    }
    st.players = st.players.filter(q => q !== p);
    const before = st.obstacles.length;
    st.obstacles = st.obstacles.filter(o => o.owner !== p.id);
    if (st.obstacles.length !== before) st.obsRev++;
    scheduleLobby();
  }

  // 1인당 장애물 수를 줄이면 초과분은 최근 것부터 삭제
  function trimObstacles() {
    const keep = [];
    for (const p of st.players) {
      const mine = st.obstacles.filter(o => o.owner === p.id).sort((a, b) => a.seq - b.seq);
      keep.push(...mine.slice(0, st.setup.obsPer));
    }
    if (keep.length !== st.obstacles.length) {
      st.obstacles = st.obstacles.filter(o => keep.includes(o));
      st.obsRev++;
    }
  }

  // ---------- 방 ----------
  function netHandlers() {
    return {
      onStatus(level, text) { const el = $('net'); if (el) { el.className = 'net ' + level; el.textContent = text; } },
      onOpen(code) { st.code = code; renderJoin(); },
      onCode(code) { st.code = code; renderJoin(); saveRoom(); Render.toast('방코드가 바뀌었어요: ' + code); },
      onJoin() { /* hello를 기다린다 */ },
      onData,
      onLeave(conn) {
        const p = byConn(conn);
        if (!p) return;
        p.conn = null; p.online = false;
        if (!p.name) st.players = st.players.filter(q => q !== p);
        scheduleLobby();
      },
      onStale(conn) { const p = byConn(conn); if (p) { p.online = false; scheduleLobby(); } },
    };
  }
  function openRoom(code) {
    st.roomOpen = true;
    st.code = code || Net.makeCode();
    st.net = new Net.HostNet(st.code, netHandlers());
    renderJoin();
  }
  function saveRoom() {
    if (!st.roomOpen) return;
    ss.set('plb.room', {
      code: st.code, setup: st.setup, pseq: st.pseq, oseq: st.oseq, kicked: st.kicked,
      players: named().map(p => ({ id: p.id, cid: p.cid, name: p.name, color: p.color, x: p.x, ready: p.ready, local: p.local })),
      obstacles: st.obstacles,
    });
  }
  function restoreRoom() {
    const s = ss.get('plb.room');
    if (!s || !s.code || !Array.isArray(s.players)) return false;
    st.setup = Object.assign(st.setup, s.setup || {});
    const parsed = parseLabels(st.setup.labels);
    if (parsed.err) return false;
    st.labels = parsed.labels;
    st.pseq = s.pseq || 1; st.oseq = s.oseq || 1; st.kicked = s.kicked || [];
    st.players = s.players.map(p => Object.assign({ w: 1, fontM: 1, online: !!p.local, conn: null }, p));
    st.players.forEach(p => { measure(p); Glyph.loadFont(p.name).then(() => { measure(p); scheduleLobby(); }); });
    st.obstacles = (s.obstacles || []).filter(o => Sim.OBS[o.kind]);
    st.phase = 'lobby';
    openRoom(s.code);
    return true;
  }

  // ---------- 게임 ----------
  function startGame() {
    const parts = named();
    st.parts = parts.map(p => p.id);
    st.phase = 'countdown';
    st.results = []; st.lastResults = {}; st.shapes = {};
    st.game = null; st.acc = 0;
    st.countStart = performance.now(); st.lastCount = 0;
    st.fx = new Render.Fx();
    st.cam = null;
    const token = ++st.runToken;
    Render.Sound.unlock();
    for (const p of parts) send(p, { t: 'start' });
    $('results').innerHTML = '';
    showPanel();
    Glyph.loadFont(parts.map(p => p.name).join('')).then(() => {
      if (token !== st.runToken) return;
      const names = parts.map(p => {
        const sh = Glyph.trace(p.name);
        st.shapes[p.id] = sh;
        p.w = sh.w; p.fontM = sh.fontM;
        return { id: p.id, polys: sh.polys, w: sh.w, h: sh.h, x: p.x };
      });
      const seed = (root.crypto && root.crypto.getRandomValues ? root.crypto.getRandomValues(new Uint32Array(1))[0] : Math.random() * 2 ** 32) >>> 0 || 1;
      const labels = st.labels.slice();
      if (st.setup.blind) shuffle(labels, Sim.makeRng(seed ^ 0x5bd1e995));
      const obstacles = st.obstacles.filter(o => st.parts.includes(o.owner))
        .map(o => ({ id: o.id, owner: o.owner, kind: o.kind, x: o.x, y: o.y, a: o.a }));
      st.game = new Sim.Game({ seed, map: MAP, labels, names, obstacles });
      st.seed = seed;
    });
  }
  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function onGameEvent(e) {
    const g = st.game, fx = st.fx;
    switch (e.t) {
      case 'confirm': {
        const p = byId(e.id), color = p ? p.color : Render.COL.amber;
        const order = st.results.length + 1;
        st.results.push({ id: e.id, name: p ? p.name : '?', color, label: e.label, seg: e.seg, t: e.time });
        st.lastResults[e.id] = { label: e.label, seg: e.seg, order };
        fx.laser(e.x);
        fx.float(Math.max(1.5, Math.min(C.W - 1.5, e.x)), e.label, color);
        Render.Sound.play('confirm');
        if (p) send(p, { t: 'mine', label: e.label, seg: e.seg, order });
        addResultRow(order, p ? p.name : '?', color, e.label);
        break;
      }
      case 'hit': fx.ring(e.x, e.y, Render.COL.brick, 0.6); Render.Sound.play('hit'); break;
      case 'break': {
        fx.shards(e.x, e.y, e.kind === 'block' ? Render.COL.brick : e.kind === 'tramp' ? Render.COL.teal : Render.COL.magenta);
        if (!g || !g.suddenDone) Render.Sound.play('break');   // 서든데스 일괄 파괴는 'sudden'에서 한 번만
        break;
      }
      case 'bounce': fx.ring(e.x, e.y, Render.COL.teal, 1.2); Render.Sound.play('tramp'); break;
      case 'kick':
        fx.ring(e.x, e.y, Render.COL.magenta, 1.3);
        if (!e.id) fx.kick(e.x, e.y);
        Render.Sound.play('bump');
        break;
      case 'sudden': banner('서든데스! 유저 장애물이 모두 부서졌어요'); Render.Sound.play('break'); break;
      case 'final': banner('마무리: 남은 이름은 모든 걸 통과해요'); break;
      case 'end': endGame(); break;
    }
  }

  function endGame() {
    st.phase = 'done';
    st.doneAt = performance.now();
    const results = st.results.map(r => ({ name: r.name, color: r.color, label: r.label }));
    for (const p of st.players) if (p.conn) send(p, { t: 'end', results });
    showPanel();
    setTimeout(() => { if (st.phase === 'done') showResults(); }, 1400);
  }

  // 대기실로: 준비만 초기화하고 위치·장애물은 유지 (clearObstacles면 장애물도 지움)
  function backToLobby(clearObstacles) {
    st.runToken++;
    st.game = null; st.parts = []; st.lastResults = {};
    st.phase = 'lobby';
    hideOverlay();
    for (const p of st.players) if (!p.local) p.ready = false;
    if (clearObstacles && st.obstacles.length) { st.obstacles = []; st.obsRev++; }
    for (const p of st.players) if (p.conn) send(p, { t: 'lobby-again' });
    const base = lobbyBase();
    for (const p of st.players) if (p.conn && p.name) st.net.send(p.conn, lobbyFor(p.conn, base, true));
    showPanel();
    scheduleLobby();
  }

  // ---------- 화면 ----------
  function show(id, on) { const el = $(id); if (el) el.classList.toggle('hidden', !on); }
  function showPanel() {
    show('hSetup', st.phase === 'setup');
    show('hLobby', st.phase === 'lobby');
    show('hRun', st.phase === 'countdown' || st.phase === 'running' || st.phase === 'done');
    $('openRoom').textContent = st.roomOpen ? '적용' : '방 열기';
    show('cancelEdit', st.roomOpen);
    show('joinbox', !st.roomOpen);
    if (!st.abortArmed) $('abortBtn').textContent = st.phase === 'done' ? '대기실로' : '중단하고 대기실로';
    $('runTitle').textContent = st.phase === 'countdown' ? '곧 시작해요' : st.phase === 'done' ? '끝' : '진행 중';
    st.panelDirty = true;
  }
  function banner(text) {
    const b = $('banner');
    b.textContent = text;
    b.classList.add('on');
    clearTimeout(banner.t);
    banner.t = setTimeout(() => b.classList.remove('on'), 3200);
  }
  function hideOverlay() { $('overlay').classList.add('hidden'); }

  function renderJoin() {
    $('code').textContent = st.code || '----';
    const url = location.origin + location.pathname + '?room=' + st.code;
    const local = location.protocol === 'file:' || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
    $('joinUrl').textContent = local ? '폰에서 접속하려면 GitHub Pages 주소로 열어주세요' : url.replace(/^https?:\/\//, '');
    $('joinUrl').title = url;
    drawQR(url);
  }
  function drawQR(url) {
    const cv = $('qr');
    if (!root.qrcode) return;
    try {
      const qr = root.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const n = qr.getModuleCount(), size = 300;
      cv.width = size; cv.height = size;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
      const cell = Math.floor(size / (n + 4)), off = Math.floor((size - cell * n) / 2);
      g.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(off + c * cell, off + r * cell, cell, cell);
    } catch (e) { console.warn('QR 생성 실패', e); }
  }

  function renderSetupHint() {
    const parsed = parseLabels($('labels').value);
    $('labelsHint').textContent = parsed.err ? '' : `${parsed.labels.length}칸`;
    return parsed;
  }

  function renderLobbyPanel() {
    const list = named();
    const ready = list.filter(p => p.ready || p.local).length;
    $('cPlayers').textContent = list.length;
    $('cReady').textContent = ready;
    $('cSlots').textContent = st.labels.length;
    $('cSlotsWrap').classList.toggle('warn', list.length > st.labels.length);
    const ul = $('plist');
    ul.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'QR을 찍고 들어오면 여기에 이름이 보여요';
      ul.appendChild(li);
    }
    for (const p of list) {
      const li = document.createElement('li');
      if (!p.online && !p.local) li.className = 'off';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag' + (p.ready || p.local ? ' ok' : '');
      tag.textContent = p.local ? '폰 없음' : !p.online ? '연결 끊김' : p.ready ? '준비' : '대기';
      const oc = document.createElement('span'); oc.className = 'ocount';
      oc.textContent = p.local || !st.setup.obsPer ? '' : `장애물 ${nObs(p.id)}`;
      const x = document.createElement('button');
      x.className = 'x'; x.type = 'button'; x.textContent = '×';
      x.title = p.name + ' 내보내기'; x.setAttribute('aria-label', p.name + ' 내보내기');
      x.onclick = () => kick(p);
      li.append(dot, nm, tag, oc, x);
      ul.appendChild(li);
    }
    if (!st.startArmed) $('startBtn').textContent = '시작';
  }

  function renderRunPanel() {
    const g = st.game;
    $('clock').textContent = g ? g.t.toFixed(1) : '0.0';
    const left = g ? g.remaining : st.parts.length, open = g ? g.segments.openCount() : st.labels.length;
    $('runSub').textContent = `남은 이름 ${left} / 남은 칸 ${open}`;
  }
  function addResultRow(order, name, color, label) {
    const li = document.createElement('li');
    li.className = 'new';
    li.style.setProperty('--c', color);
    li.innerHTML = '<span class="ord"></span><span class="nm"></span><span class="lb"></span>';
    li.children[0].textContent = order;
    li.children[1].textContent = name;
    li.children[2].textContent = label;
    const ol = $('results');
    ol.appendChild(li);
    li.scrollIntoView({ block: 'nearest' });
  }
  function showResults() {
    const ul = $('finalList');
    ul.innerHTML = '';
    st.results.forEach((r, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', r.color);
      li.innerHTML = '<span class="ord"></span><span class="nm"></span><span class="lb"></span>';
      li.children[0].textContent = i + 1;
      li.children[1].textContent = r.name;
      li.children[2].textContent = r.label;
      ul.appendChild(li);
    });
    const left = st.game ? st.game.segments.list.filter(s => !s.closed).map(s => s.label) : [];
    $('leftover').textContent = left.length ? '배정되지 않은 칸: ' + left.join(', ') : '';
    show('leftover', left.length > 0);
    $('overlay').classList.remove('hidden');
  }
  function resultText() {
    const lines = ['핀볼 사다리 결과'];
    st.results.forEach((r, i) => lines.push(`${i + 1}. ${r.name}: ${r.label}`));
    const left = st.game ? st.game.segments.list.filter(s => !s.closed).map(s => s.label) : [];
    if (left.length) lines.push('배정되지 않은 칸: ' + left.join(', '));
    return lines.join('\n');
  }
  function copyText(text) {
    const done = () => Render.toast('결과를 복사했어요', 'ok');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { Render.toast('복사하지 못했어요', 'bad'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // ---------- 보드 ----------
  function fullView(topY) {
    return { x0: C.VIEW.x0, x1: C.VIEW.x1, y0: Math.min(C.VIEW.y0, topY - 1.4), y1: C.VIEW.y1 };
  }
  function lobbyNames() {
    const pos = layout();
    return named().map(p => ({ id: p.id, text: p.name, color: p.color, x: pos[p.id].x, y: pos[p.id].y, fontM: p.fontM, w: p.w, local: p.local }));
  }
  function gameNames() {
    const g = st.game, out = [];
    for (const n of g.names.values()) {
      if (n.done || !n.body) continue;
      const pos = n.body.getPosition(), p = byId(n.id);
      out.push({
        id: n.id, text: p ? p.name : '?', color: p ? p.color : Render.COL.chrome, x: pos.x, y: pos.y, a: n.body.getAngle(),
        shape: st.shapes[n.id], ghost: n.noCollide || n.phaseUntil > g.t || n.ghostUntil > g.t, w: n.w, h: n.h,
      });
    }
    return out;
  }
  function targetView(names, w, h) {
    const top = names.reduce((m, n) => Math.min(m, n.y), C.START_Y);
    const full = fullView(top);
    if (!st.follow || st.phase !== 'running' || !names.length) return full;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of names) {
      const r = Math.max(n.w || 1, n.h || 1) / 2;
      x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r);
      y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r);
    }
    x0 -= 3; x1 += 3; y0 -= 3; y1 += 3;
    if (y1 - y0 < 16) { const c = (y0 + y1) / 2; y0 = c - 8; y1 = c + 8; }
    const aspect = w / Math.max(1, h);
    let vw = x1 - x0, vh = y1 - y0;
    if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
    const fw = full.x1 - full.x0, fh = full.y1 - full.y0;
    vw = Math.min(vw, fw); vh = Math.min(vh, fh);
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    cx = Math.max(full.x0 + vw / 2, Math.min(full.x1 - vw / 2, cx));
    cy = Math.max(full.y0 + vh / 2, Math.min(full.y1 - vh / 2, cy));
    return { x0: cx - vw / 2, x1: cx + vw / 2, y0: cy - vh / 2, y1: cy + vh / 2 };
  }
  function smooth(cam, t, dt) {
    if (!cam) return Object.assign({}, t);
    const a = 1 - Math.exp(-dt * 2.6);
    for (const k of ['x0', 'x1', 'y0', 'y1']) cam[k] += (t[k] - cam[k]) * a;
    return cam;
  }

  function segsForDraw() {
    if (st.game) return st.game.segments.list;
    const labels = st.phase === 'setup' ? parseLabels($('labels').value).labels : st.labels;
    const w = C.W / Math.max(1, labels.length);
    return labels.map(label => ({ label, w, closed: false }));
  }

  function draw(dt, now) {
    const cv = $('board');
    const { ctx, w, h } = Render.setupCanvas(cv);
    const running = st.game && (st.phase === 'running' || st.phase === 'done' || st.phase === 'countdown');
    const names = running ? gameNames() : st.phase === 'setup' && !st.roomOpen ? [] : lobbyNames();
    st.cam = smooth(st.cam, targetView(names, w, h), dt);
    const T = st.T = Render.makeT(w, h, st.cam, 14);
    const lobbyish = st.phase === 'lobby' || st.phase === 'setup';
    let countdown = null;
    if (st.phase === 'countdown') countdown = Math.max(1, COUNT_SEC - Math.floor((now - st.countStart) / 1000));
    Render.drawScene(ctx, T, {
      map: MAP, view: st.cam, mode: st.phase,
      mills: st.game ? st.game.mills.map(m => ({ el: m.el, angle: m.body.getAngle() })) : MAP.els.filter(e => e.kind === 'mill').map(el => ({ el, angle: el.speed * now / 1000 })),
      obstacles: st.game ? [...st.game.obs.values()] : st.obstacles,
      colorOf,
      names,
      segs: segsForDraw(), blind: st.setup.blind && st.phase !== 'setup', now: st.game ? st.game.t : 0,
      showZone: lobbyish && st.setup.obsPer > 0, showStart: lobbyish || st.phase === 'countdown', showMillRange: lobbyish,
      fx: st.fx, countdown,
    });
  }

  // ---------- 메인 루프 ----------
  let last = 0;
  function frame(ts) {
    const now = ts || performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    try { tick(dt, now); } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  }
  function tick(dt, now) {
    if (st.phase === 'countdown') {
      const el = (now - st.countStart) / 1000, n = Math.floor(el);
      if (n !== st.lastCount && n < COUNT_SEC) { st.lastCount = n; Render.Sound.play('tick'); }
      if (el >= COUNT_SEC && st.game) {
        st.phase = 'running';
        st.acc = 0;
        Render.Sound.play('go');
        showPanel();
      }
    }
    const g = st.game;
    if (st.phase === 'running' && g && !g.over) {
      st.acc += dt * (slowMo(g) ? 0.4 : 1);
      let n = 0;
      const t0 = performance.now();
      while (st.acc >= C.DT && n < 16) {
        g.step();
        st.acc -= C.DT; n++;
        for (const e of g.drainEvents()) onGameEvent(e);
        if (g.over) break;
      }
      if (n >= 16) { st.acc = 0; st.stats.slowFrames++; }
      if (n) { st.stats.steps += n; st.stats.stepMs += performance.now() - t0; st.stats.maxSteps = Math.max(st.stats.maxSteps, n); }
      st.stats.frames++;
    }
    st.fx.update(dt);
    draw(dt, now);
    if (st.phase === 'running' || st.phase === 'countdown' || st.phase === 'done') renderRunPanel();
    if (st.panelDirty) { st.panelDirty = false; if (st.phase === 'lobby') renderLobbyPanel(); }
  }
  // 남은 이름 ≤ 2, 열린 칸 ≥ 2, 결승선 2.5m 위에 이름이 있으면 0.4배속
  function slowMo(g) {
    if (g.remaining > 2 || g.segments.openCount() < 2) return false;
    for (const n of g.names.values()) {
      if (n.done || !n.body) continue;
      const y = n.body.getWorldCenter().y;
      if (y > C.FINISH_Y - 2.5 && y < C.FINISH_Y) return true;
    }
    return false;
  }

  // ---------- 보드 드래그: 폰 없는 사람의 출발 위치 ----------
  function hitLocal(px, py) {
    if (!st.T || st.phase !== 'lobby') return null;
    const mx = st.T.mx(px), my = st.T.my(py);
    for (const n of lobbyNames().reverse()) {
      if (!n.local) continue;
      if (Math.abs(mx - n.x) < n.w / 2 + 0.2 && Math.abs(my - n.y) < n.fontM / 2 + 0.3) return { n, off: mx - n.x };
    }
    return null;
  }
  function bindBoard() {
    const cv = $('board');
    const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => {
      const [px, py] = pt(e), hit = hitLocal(px, py);
      if (!hit) return;
      st.drag = { id: hit.n.id, off: hit.off };
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', e => {
      const [px, py] = pt(e);
      if (st.drag) {
        const p = byId(st.drag.id);
        if (p) { p.x = Sim.clampDropX(r2(st.T.mx(px) - st.drag.off), p.w); scheduleLobby(); }
      } else cv.style.cursor = hitLocal(px, py) ? 'grab' : '';
    });
    const end = () => { if (st.drag) { st.drag = null; cv.style.cursor = ''; } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // ---------- 버튼 ----------
  function bindUI() {
    const ta = $('labels');
    ta.value = st.setup.labels;
    $('obsOut').textContent = st.setup.obsPer;
    $('blind').checked = !!st.setup.blind;
    renderSetupHint();
    const saveSetup = () => ls.set('plb.setup', { labels: ta.value, obsPer: +$('obsOut').textContent, blind: $('blind').checked });
    ta.addEventListener('input', () => { renderSetupHint(); $('setupErr').textContent = ''; saveSetup(); });
    const step = d => { $('obsOut').textContent = Math.max(0, Math.min(5, +$('obsOut').textContent + d)); saveSetup(); };
    $('obsMinus').onclick = () => step(-1);
    $('obsPlus').onclick = () => step(1);
    $('blind').onchange = saveSetup;

    $('openRoom').onclick = () => {
      const parsed = renderSetupHint();
      if (parsed.err) { $('setupErr').textContent = parsed.err; return; }
      const prevLabels = st.labels.join('\n'), prevBlind = st.setup.blind, prevObs = st.setup.obsPer;
      st.setup = { labels: ta.value, obsPer: +$('obsOut').textContent, blind: $('blind').checked };
      st.labels = parsed.labels;
      if (prevLabels !== st.labels.join('\n') || prevBlind !== st.setup.blind) st.labRev++;
      if (st.setup.obsPer < prevObs) trimObstacles();
      saveSetup();
      Render.Sound.unlock();
      st.phase = 'lobby';
      if (!st.roomOpen) openRoom();
      showPanel();
      scheduleLobby();
    };
    $('cancelEdit').onclick = () => { st.phase = 'lobby'; showPanel(); scheduleLobby(); };
    $('editSetup').onclick = () => {
      ta.value = st.setup.labels;
      $('obsOut').textContent = st.setup.obsPer;
      $('blind').checked = st.setup.blind;
      renderSetupHint();
      st.phase = 'setup';
      showPanel();
    };
    $('joinForm').onsubmit = e => {
      e.preventDefault();
      const code = Net.normCode($('joinCode').value);
      if (code.length !== 4) { Render.toast('방코드 4자리를 입력해주세요', 'bad'); return; }
      location.href = location.pathname + '?room=' + code;
    };
    $('addForm').onsubmit = e => {
      e.preventDefault();
      const name = normName($('addName').value), err = checkName(name, null);
      if (err) { $('lobbyErr').textContent = err; return; }
      if (named().length >= C.MAX_PLAYERS) { $('lobbyErr').textContent = `최대 ${C.MAX_PLAYERS}명까지예요`; return; }
      const p = { id: 'p' + st.pseq++, cid: null, name: null, color: freeColor(), x: C.W / 2, w: 1, fontM: 1, ready: true, local: true, online: true, conn: null };
      st.players.push(p);
      setName(p, name);
      $('addName').value = '';
      $('lobbyErr').textContent = '';
      scheduleLobby();
    };
    $('startBtn').onclick = () => {
      const list = named(), err = $('lobbyErr');
      if (!list.length) { err.textContent = '참가자가 없어요'; return; }
      if (list.length > st.labels.length) { err.textContent = `칸이 ${list.length - st.labels.length}개 부족해요`; return; }
      const notReady = list.filter(p => !p.ready && !p.local);
      if (notReady.length && !st.startArmed) {
        st.startArmed = true;
        $('startBtn').textContent = '그래도 시작';
        err.textContent = `아직 준비 안 된 사람이 ${notReady.length}명 있어요`;
        clearTimeout(st.armTimer);
        st.armTimer = setTimeout(() => { st.startArmed = false; $('startBtn').textContent = '시작'; err.textContent = ''; }, 3000);
        return;
      }
      st.startArmed = false;
      clearTimeout(st.armTimer);
      err.textContent = '';
      startGame();
    };
    $('camBtn').onclick = () => {
      st.follow = !st.follow;
      $('camBtn').textContent = st.follow ? '따라가기' : '전체 보기';
    };
    $('soundBtn').onclick = () => {
      Render.Sound.on = !Render.Sound.on;
      Render.Sound.unlock();
      $('soundBtn').textContent = Render.Sound.on ? '소리 켬' : '소리 끔';
    };
    $('abortBtn').onclick = () => {
      if (st.phase === 'done') { backToLobby(false); return; }
      if (!st.abortArmed) {
        st.abortArmed = true;
        $('abortBtn').textContent = '한 번 더 누르면 중단해요';
        setTimeout(() => { st.abortArmed = false; $('abortBtn').textContent = '중단하고 대기실로'; }, 3000);
        return;
      }
      st.abortArmed = false;
      backToLobby(false);
    };
    $('againBtn').onclick = () => backToLobby(false);
    $('copyBtn').onclick = () => copyText(resultText());
    $('resetBtn').onclick = () => {   // 처음부터: 방은 유지, 장애물·준비를 지우고 설정 화면으로
      backToLobby(true);
      ta.value = st.setup.labels;
      $('obsOut').textContent = st.setup.obsPer;
      $('blind').checked = st.setup.blind;
      renderSetupHint();
      st.phase = 'setup';
      showPanel();
    };
    root.addEventListener('beforeunload', () => saveRoom());
  }

  function start() {
    const saved = ls.get('plb.setup');
    if (saved && typeof saved.labels === 'string') {
      st.setup.labels = saved.labels;
      st.setup.obsPer = Math.max(0, Math.min(5, saved.obsPer | 0));
      st.setup.blind = !!saved.blind;
    }
    if (!restoreRoom()) st.labels = parseLabels(st.setup.labels).labels;
    bindUI();
    bindBoard();
    showPanel();
    if (st.roomOpen) scheduleLobby();
    requestAnimationFrame(frame);
    root.PLB = { st, parseLabels, lobbyMsg: () => lobbyFor({}, lobbyBase(), true) };   // 테스트·디버깅용
  }

  root.Host = { start, parseLabels };
})(typeof self !== 'undefined' ? self : this);
