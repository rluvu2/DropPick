/* 핀볼 사다리 — 호스트(PC) 화면: 설정 → 대기실 → 카운트다운 → 진행 → 결과
 * 물리는 여기서만 돈다. 폰은 입력만 보내고, 이름·출발 위치·장애물은 전부 여기서 다시 검증한다.
 */
(function (root) {
  'use strict';
  const Sim = root.Sim, C = Sim.C, Glyph = root.Glyph, Render = root.Render, Net = root.Net;
  const maps = {};
  const mapOf = id => maps[id] || (maps[id] = Sim.buildMap(id === 'short' ? 'short' : 'long'));
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
    setup: { labels: DEFAULT_LABELS, obsPer: 2, blind: false, course: 'long' },
    map: mapOf('long'), courseSel: 'long',
    labels: [], labRev: 1,
    code: null, net: null,
    players: [], pseq: 1, kicked: [],
    obstacles: [], oseq: 1, obsRev: 1,
    game: null, parts: [], shapes: {}, results: [], lastResults: {}, runToken: 0,
    acc: 0, countStart: 0, lastCount: 0, doneAt: 0,
    follow: true, cam: null, fx: new Render.Fx(), T: null, panelDirty: true,
    speed: 1, trails: new Map(), stageSeen: 0, pack: null, focusY: null, inset: false, insetSince: 0, special: new Set(), manual: null, liveAt: 0, progAt: 0, mmRect: null,
    zoomW: null, leaderId: null, goAt: 0, hudW: 0, folded: false, lookRect: null, panelSpace: -1,
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
      t: 'lobby', obsPer: st.setup.obsPer, course: st.map.id,
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
      obsPer: st.setup.obsPer, result: st.lastResults[p.id] || null, code: st.code, inGame: st.parts.includes(p.id), course: st.map.id,
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
    const v = Sim.validateObstacle(st.map, st.obstacles, o);
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
    st.map = mapOf(st.setup.course); st.courseSel = st.map.id;
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
    st.fx = new Render.Fx(st.map.F);
    // 카메라는 시작 전에 보던 곳에서 출발 지점으로 다가간다
    look.tour = null;
    st.cam = st.lookRect ? Object.assign({}, st.lookRect) : null;
    st.manual = null; st.zoomW = null; st.leaderId = null; st.goAt = 0;
    st.trails = new Map(); st.stageSeen = 0; st.pack = null; st.focusY = null; st.inset = false;
    const token = ++st.runToken;
    Render.Sound.unlock();
    for (const p of parts) send(p, { t: 'start', course: st.map.id });
    $('liveRank').innerHTML = '';
    show('liveWrap', false);
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
      // 가장 흔한 칸(보통 '꽝')이 아닌 칸은 '당첨'으로 보고 축하 연출을 한다. 모두 한 칸씩이면 없음
      st.special = Render.specialLabels(labels);
      const obstacles = st.obstacles.filter(o => st.parts.includes(o.owner))
        .map(o => ({ id: o.id, owner: o.owner, kind: o.kind, x: o.x, y: o.y, a: o.a }));
      st.game = new Sim.Game({ seed, map: st.map, labels, names, obstacles });
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
        // 도착: 결승선에서 빛기둥이 솟고, 이름 색 불꽃이 튀고, 레이저를 따라 물결이 퍼지고, 'n등'이 튀어 오른다
        const p = byId(e.id), color = p ? p.color : Render.COL.amber, name = p ? p.name : '?';
        const order = st.results.length + 1, win = st.special.has(e.label), F = st.map.F;
        const x = Math.max(1.5, Math.min(C.W - 1.5, e.x));
        st.results.push({ id: e.id, name, color, label: e.label, seg: e.seg, t: e.time });
        st.lastResults[e.id] = { label: e.label, seg: e.seg, order };
        fx.laser(e.x);
        fx.pillar(e.x, win ? Render.COL.amber : color, win);
        fx.burst(e.x, F - 0.15, color, win ? 70 : 30, win ? 1.35 : 1);
        fx.pulse(e.x, win ? Render.COL.amber : color, win);
        fx.badge(x, order + '등', color);
        if (win) fx.float(x, e.label, Render.COL.amber);
        Render.Sound.play('confirm', order);
        if (p) send(p, { t: 'mine', label: e.label, seg: e.seg, order });
        st.trails.delete(e.id);
        st.liveAt = 0;   // 순위판을 바로 다시 그린다
        if (win) {
          showWin(name, e.label, color);
          fx.confetti(x, F - 0.4, 90);
          for (let i = 0; i < 3; i++) fx.firework(4 + Math.random() * (C.W - 8), F - 7 - Math.random() * 6);
          fx.screen(Render.COL.amber, 0.5);
          fx.shake = 0.8;
          Render.Sound.play('win');
        } else if (order === 1) {
          fx.screen(color, 0.22);
        }
        break;
      }
      case 'spark': {
        // 핀·벽에 세게 부딪힘: 핀은 하얗게 번쩍, 부딪힌 자리에 이름 색 불꽃
        const p = byId(e.id), color = p ? p.color : Render.COL.chrome, strong = e.v > 5;
        if (e.kind === 'pin' && e.el >= 0) { fx.light(e.el); Render.Sound.play('pin'); }
        fx.sparks(e.x, e.y, color, strong ? 6 : 3, strong ? 0.8 : 0.55);
        if (strong) fx.flare(e.x, e.y, color);
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
        fx.sparks(e.x, e.y, Render.COL.magenta, 5);
        if (!e.id) fx.kick(e.x, e.y);
        Render.Sound.play('bump');
        break;
      case 'sudden':
        // 긴 코스는 45초쯤엔 보통 다들 장애물 구역을 지나서, 구역에 이름이 남아 있을 때만 알린다
        if (st.map.id === 'short' || e.busy) { banner('서든데스! 유저 장애물이 모두 부서졌어요'); Render.Sound.play('break'); }
        break;
      case 'rush':
        if (st.map.id !== 'short') { banner('가속! 남은 이름이 더 빨리 떨어져요'); Render.Sound.play('rush'); }
        break;
      case 'unstick':
        if (e.level >= 3 && e.level !== 9) st.trails.delete(e.id);   // 순간이동은 꼬리를 끊는다
        break;
      case 'final': banner('마무리: 남은 이름은 모든 걸 통과해요'); break;
      case 'end': endGame(); break;
    }
  }

  function endGame() {
    st.phase = 'done';
    st.doneAt = performance.now();
    renderLiveRank([]);
    const results = st.results.map(r => ({ name: r.name, color: r.color, label: r.label }));
    for (const p of st.players) if (p.conn) send(p, { t: 'end', results });
    showPanel();
    setTimeout(() => { if (st.phase === 'done') showResults(); }, 1400);
  }

  // 대기실로: 준비만 초기화하고 위치·장애물은 유지 (clearObstacles면 장애물도 지움)
  function backToLobby(clearObstacles) {
    st.runToken++;
    resetLook();
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
  const racing = () => st.phase === 'countdown' || st.phase === 'running' || st.phase === 'done';
  function showPanel() {
    show('hSetup', st.phase === 'setup');
    show('hLobby', st.phase === 'lobby');
    // 보드는 늘 화면 전체. 시작 전에는 설정·대기실 창이 그 위에 떠 있고(접을 수 있음), 진행 중에는 창 대신 시계·순위를 겹친다
    const host = document.querySelector('.host');
    host.classList.toggle('racing', racing());
    host.classList.toggle('folded', st.folded);
    show('hud', racing());
    show('panelPill', st.folded && !racing());
    show('lookTools', !racing());
    renderPill();
    renderLookTools();
    if (!racing()) { $('winFx').classList.add('hidden'); $('stageTitle').classList.remove('go'); }
    $('openRoom').textContent = st.roomOpen ? '적용' : '방 열기';
    show('cancelEdit', st.roomOpen);
    show('joinbox', !st.roomOpen);
    if (!st.abortArmed) $('abortBtn').textContent = st.phase === 'done' ? '대기실로' : '중단하고 대기실로';
    st.panelDirty = true;
  }
  // 빨간 알림 (서든데스·가속·마무리)
  function banner(text) {
    const b = $('banner');
    b.textContent = text;
    b.className = 'banner on';
    clearTimeout(banner.t);
    banner.t = setTimeout(() => b.classList.remove('on'), 3000);
  }
  // 다시 시작하는 CSS 애니메이션
  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function showWin(name, label, color) {
    const el = $('winFx');
    $('winName').textContent = name;
    $('winLabel').textContent = label;
    el.style.setProperty('--c', color);
    el.classList.remove('hidden');
    $('stageTitle').classList.remove('go');   // 구간 제목과 겹치지 않게
    replay(el, 'go');
    clearTimeout(showWin.t);
    showWin.t = setTimeout(() => el.classList.add('hidden'), 3300);
  }
  function showStageTitle(i) {
    if (!$('winFx').classList.contains('hidden')) return;   // 당첨 화면이 떠 있으면 구간 제목은 건너뛴다
    const el = $('stageTitle'), s = st.map.stages[i];
    el.innerHTML = '<small></small><span></span>';
    el.firstChild.textContent = `${i + 1}구간`;
    el.lastChild.textContent = s.name;
    el.style.setProperty('--g', Render.themeOf(i).glow);
    replay(el, 'go');
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
    renderPill();
  }

  function renderRunPanel() {
    const g = st.game;
    $('clock').textContent = g ? g.t.toFixed(1) : '0.0';
    const left = g ? g.remaining : st.parts.length, open = g ? g.segments.openCount() : st.labels.length;
    $('runSub').textContent = `남은 이름 ${left} / 남은 칸 ${open}`;
  }
  function showResults() {
    const ul = $('finalList');
    ul.innerHTML = '';
    // 당첨 칸을 먼저, 나머지는 들어온 순서대로
    const rows = st.results.map((r, i) => Object.assign({ ord: i + 1, win: st.special.has(r.label) }, r));
    rows.sort((a, b) => (b.win - a.win) || a.ord - b.ord);
    rows.forEach(r => {
      const li = document.createElement('li');
      if (r.win) li.className = 'win';
      li.style.setProperty('--c', r.color);
      li.innerHTML = '<span class="ord"></span><span class="nm"></span><span class="lb"></span>';
      li.children[0].textContent = r.ord;
      li.children[1].textContent = r.name;
      li.children[2].textContent = r.label;
      ul.appendChild(li);
    });
    const left = st.game ? st.game.segments.list.filter(s => !s.closed).map(s => s.label) : [];
    $('leftover').textContent = left.length ? '배정되지 않은 칸: ' + left.join(', ') : '';
    show('leftover', left.length > 0);
    $('overlay').classList.remove('hidden');
    ul.scrollTop = 0; ul.parentElement.scrollTop = 0;   // 지난 판에 내려 둔 스크롤이 남지 않게 (당첨이 맨 위)
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
  // 설정 화면에서는 고르는 중인 코스를 미리 보여준다
  const mapNow = () => (st.phase === 'setup' ? mapOf(st.courseSel) : st.map);
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
  // 진행 중 카메라: 가장 많이 모인 무리를 따라간다. 지금 보는 무리를 유지하다가 다른 곳에 3명 이상 더 모이면 넘어간다.
  // 무리가 좁게 모여 있으면 그만큼 확대한다(보이는 폭 31m ~ 17m, 천천히). 남은 이름이 셋 이하로 모이면 더 확대.
  // '전체 보기'는 남은 이름이 모두 들어오게. 미니맵을 끌면 4초 동안 그쪽을 본다.
  // 보드는 왼쪽 미니맵과 오른쪽 순위판 사이(안전 영역)에 오게 한다
  function packCenter(names, Hv) {
    const ys = names.map(n => n.y).sort((a, b) => b - a);   // 앞(아래)부터
    let best = null;
    for (let i = 0; i < ys.length; i++) {
      const bottom = ys[i] + 1.5;
      let cnt = 0, sum = 0;
      for (const y of ys) if (y <= bottom && y >= bottom - Hv + 2) { cnt++; sum += y; }
      if (!best || cnt > best.cnt) best = { cnt, cy: sum / cnt };   // 같으면 앞쪽
    }
    const cur = st.pack === null ? [] : ys.filter(y => Math.abs(y - st.pack) <= Hv * 0.5);
    st.pack = cur.length && best.cnt < cur.length + 3 ? cur.reduce((a, b) => a + b, 0) / cur.length : best.cy;
    return st.pack + Hv * 0.08;   // 가는 쪽(아래)을 조금 더
  }
  function safeArea(w) {
    const left = st.mmRect ? st.mmRect.x + st.mmRect.w + 12 : 0;
    return { left, right: Math.max(left + 240, w - st.hudW) };
  }
  // dt가 0이면(결승선 띠를 붙일지 미리 볼 때) 확대 상태를 바꾸지 않는다
  function raceView(names, w, h, now, insetFrac, dt) {
    insetFrac = insetFrac || 0;
    const F = st.map.F, { left, right } = safeArea(w), sw = right - left, visH = h * (1 - insetFrac);
    const top = names.reduce((m, n) => Math.min(m, n.y), C.START_Y);
    const lo = Math.min(C.VIEW.y0, top - 1.4), hi = F + C.LABEL_BAND + 0.8;
    const FULL = C.W + 1.2, Hfull = FULL * visH / sw;   // 보드 폭 전체를 보여줄 때 보이는 높이
    let Wv = FULL, cx = C.W / 2, cy = null, needH = 0;
    if (st.manual && now < st.manual.until) cy = st.manual.y;
    else if (!names.length) cy = F;
    else if (!st.follow) {
      let y0 = Infinity, y1 = -Infinity;
      for (const n of names) { y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
      cy = (y0 + y1) / 2 + 0.5;
      needH = y1 - y0 + 7;
    } else {
      if (names.length <= 3) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const n of names) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
        if (y1 - y0 < 9) { Wv = Math.max(15, Math.min(FULL, x1 - x0 + 11)); cx = (x0 + x1) / 2; cy = (y0 + y1) / 2 + 1; }
      }
      if (cy === null) {
        cy = packCenter(names, Hfull);
        // 무리의 좌우 폭(양 끝 10%는 빼고)만큼만 보여준다
        const xs = names.filter(n => Math.abs(n.y - st.pack) <= Hfull * 0.5).map(n => n.x).sort((a, b) => a - b);
        if (xs.length) {
          const cut = xs.length >= 6 ? Math.floor(xs.length * 0.1) : 0, xa = xs[cut], xb = xs[xs.length - 1 - cut];
          Wv = Math.max(17, Math.min(FULL, xb - xa + 10));
          cx = (xa + xb) / 2;
        }
      }
    }
    // 확대·축소는 천천히 (무리가 흩어졌다 모일 때마다 화면이 숨 쉬지 않게)
    if (dt) st.zoomW = st.zoomW === null ? Wv : st.zoomW + (Wv - st.zoomW) * (1 - Math.exp(-dt * 1.6));
    if (st.zoomW !== null) Wv = st.zoomW;
    let k = sw / Wv;
    if (needH) k = Math.min(k, visH / needH);
    const vw = sw / k, Hs = h / k;
    cx = vw >= FULL ? C.W / 2 : Math.max(vw / 2 - 0.6, Math.min(C.W + 0.6 - vw / 2, cx));
    if (dt) st.focusY = cy;
    cy += Hs * insetFrac / 2;   // 아래 결승선 띠에 가리는 만큼 내려서, 보이는 부분 가운데에 오게
    const a = lo + Hs / 2, b = hi - Hs / 2;
    cy = a > b ? (lo + hi) / 2 : Math.max(a, Math.min(b, cy));
    const x0 = cx - vw / 2 - left / k;
    return { x0, x1: x0 + w / k, y0: cy - Hs / 2, y1: cy + Hs / 2 };
  }
  function smooth(cam, t, dt) {
    if (!cam) return Object.assign({}, t);
    const far = Math.abs((t.y0 + t.y1) / 2 - (cam.y0 + cam.y1) / 2) > (t.y1 - t.y0);
    const a = 1 - Math.exp(-dt * (far ? 5 : 3));
    for (const k of ['x0', 'x1', 'y0', 'y1']) cam[k] += (t[k] - cam[k]) * a;
    return cam;
  }
  // 미니맵은 왼쪽 위 (오른쪽은 순위판)
  function mmRectFor(map, w, h) {
    const mw = 88, mh = Math.min(h - 28, mw * (map.F + 10) / (C.W + 2));
    return { x: 14, y: 14, w: mw, h: mh };
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
    const map = mapNow(), clock = now / 1000;
    // 진행 중에만 오른쪽에 순위판 (폭은 여기서 정하고 CSS 변수로 넘긴다)
    const hudW = racing() ? Math.round(Math.max(220, Math.min(320, w * 0.22))) : 0;
    if (hudW !== st.hudW) {
      st.hudW = hudW;
      const host = document.querySelector('.host');
      if (hudW) host.style.setProperty('--hud-w', hudW + 'px'); else host.style.removeProperty('--hud-w');
    }
    if (racing()) drawRace(ctx, w, h, map, clock, now, dt);
    else drawLobby(ctx, w, h, map, clock, dt, now);
  }

  // ---------- 시작 전: 코스 둘러보기 ----------
  // 보드 폭을 꽉 채운 큰 화면으로 코스의 한 부분을 보여준다(설정 창에 가리지 않는 곳에).
  // 왼쪽 미니맵을 누르거나 끌기, 휠(굴리기)·Ctrl+휠(확대·축소)·빈 곳 끌기로 원하는 곳을 보고,
  // '코스 둘러보기'는 출발 지점에서 결승선까지 천천히 내려갔다가 돌아온다. 이름·장애물은 출발 지점에 있다.
  // look.cy·cx·zoomW는 목표, look.cur는 실제로 보이는 값(부드럽게 따라감). cy가 null이면 출발 지점
  const look = { cy: null, cx: null, zoomW: null, cur: null, tour: null, drag: null, geo: null };
  function resetLook() { look.cy = null; look.cx = null; look.zoomW = null; look.cur = null; look.tour = null; renderLookTools(); }
  function stopTour() { if (look.tour) { look.tour = null; renderLookTools(); } }
  function lobbyMini(map, w, h) {
    const mw = Math.round(Math.max(70, Math.min(130, (h - 28) * (C.W + 2) / (map.F + 10))));
    return { x: 14, y: 14, w: mw, h: Math.min(h - 28, mw * (map.F + 10) / (C.W + 2)) };
  }
  // 설정 창이 보드를 가리는 만큼 (오른쪽에 떠 있으면 폭, 좁은 화면에서 아래에서 올라왔으면 높이)
  function panelCover(w, h) {
    if (racing() || st.folded) return { right: 0, bottom: 0 };
    const p = $('panel').getBoundingClientRect(), b = $('board').getBoundingClientRect();
    if (!p.width) return { right: 0, bottom: 0 };
    if (p.left - b.left > w * 0.45) return { right: w - (p.left - b.left) + 12, bottom: 0 };
    return { right: 0, bottom: Math.max(0, h - (p.top - b.top) + 8) };
  }
  // 목표 화면: 보드 폭이 안전 영역(미니맵 오른쪽 ~ 설정 창 왼쪽)에 맞게. 코스가 화면보다 조금만 길면(짧은 코스) 다 들어오게
  function lookTarget(map, w, h, top, now, cover) {
    const left = st.mmRect.x + st.mmRect.w + 16, right = Math.max(left + 200, w - cover.right - 10);
    const vTop = 0, vBot = Math.max(120, h - cover.bottom), sw = right - left, FULL = C.W + 1.2;
    const yTop = Math.min(C.VIEW.y0, top - 1.6), yEnd = map.F + C.LABEL_BAND + 0.8, courseH = yEnd - yTop;
    const visFull = (vBot - vTop) * FULL / sw;
    if (look.zoomW === null) look.zoomW = courseH <= visFull * 1.35 ? FULL * Math.max(1, courseH / visFull) : FULL;
    look.zoomW = Math.max(12, Math.min(FULL * 2.4, look.zoomW));
    const k = sw / look.zoomW, visH = (vBot - vTop) / k;
    const clampY = y => (visH >= courseH ? (yTop + yEnd) / 2 : Math.max(yTop + visH / 2, Math.min(yEnd - visH / 2, y)));
    if (look.tour) {
      const e = (now - look.tour.t0) / 1000, A = clampY(-Infinity), B = clampY(Infinity);
      const D = Math.max(3, (B - A) / 9), hold = 1.4, R = Math.min(3, Math.max(1, D * 0.35));
      const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      if (e < D) look.cy = A + (B - A) * ease(e / D);
      else if (e < D + hold) look.cy = B;
      else if (e < D + hold + R) look.cy = B + (A - B) * ease((e - D - hold) / R);
      else { look.tour = null; look.cy = null; renderLookTools(); }
    }
    if (look.cy !== null) look.cy = clampY(look.cy);   // 끝을 넘겨 굴린 만큼 쌓이지 않게
    const cy = look.cy === null ? clampY(-Infinity) : look.cy;
    const half = Math.min(look.zoomW, FULL) / 2;
    const cx = look.zoomW >= FULL || look.cx === null ? C.W / 2 : Math.max(half - 0.6, Math.min(C.W + 0.6 - half, look.cx));
    if (look.cx !== null) look.cx = cx;
    look.geo = { left, sw, vTop, vBot };
    return { cx, cy, zoomW: look.zoomW, left, sw, vTop, vBot, tour: !!look.tour };
  }
  // 확대·축소: 화면의 (px, py) 아래 지점이 그대로 있게
  function zoomBy(f, px, py) {
    if (!look.cur || !look.geo || !st.T) return;
    const g = look.geo, wx = st.T.mx(px), wy = st.T.my(py);
    const z = Math.max(12, Math.min((C.W + 1.2) * 2.4, look.zoomW * f)), k = g.sw / z;
    look.zoomW = z;
    look.cy = wy - (py - (g.vTop + g.vBot) / 2) / k;
    look.cx = wx - (px - (g.left + g.sw / 2)) / k;
    Object.assign(look.cur, { zoomW: z, cy: look.cy, cx: look.cx });
  }
  function renderLookTools() {
    const b = $('tourBtn');
    if (!b) return;
    b.textContent = look.tour ? '멈추기' : '코스 둘러보기';
    b.classList.toggle('on', !!look.tour);
  }
  // 접힌 창: 방이 열렸으면 방코드와 인원, 아니면 게임 이름
  function renderPill() {
    if (!$('pillCode')) return;
    $('pillCode').textContent = st.roomOpen ? st.code || '----' : '핀볼 사다리';
    $('pillInfo').textContent = st.roomOpen ? `${named().length}명 참가` : '설정';
  }

  function drawLobby(ctx, w, h, map, clock, dt, now) {
    const names = st.phase === 'setup' && !st.roomOpen ? [] : lobbyNames();
    const top = names.reduce((m, n) => Math.min(m, n.y), C.START_Y);
    const cover = panelCover(w, h);
    st.mmRect = lobbyMini(map, w, Math.max(160, h - cover.bottom));   // 아래에서 올라온 창(좁은 화면)에 가리지 않게
    const v = lookTarget(map, w, h, top, now, cover);
    // 굴리기는 부드럽게 따라가고, 둘러보기는 경로를 그대로
    const cur = look.cur || (look.cur = { cx: v.cx, cy: v.cy, zoomW: v.zoomW });
    const a = v.tour ? 1 : 1 - Math.exp(-dt * 11);
    for (const key of ['cx', 'cy', 'zoomW']) cur[key] += (v[key] - cur[key]) * a;
    const k = v.sw / cur.zoomW, x0 = cur.cx - cur.zoomW / 2 - v.left / k, y0 = cur.cy - (v.vTop + v.vBot) / 2 / k;
    const view = st.lookRect = { x0, x1: x0 + w / k, y0, y1: y0 + h / k };
    const T = st.T = Render.makeT(w, h, view, 0);   // 폰 없는 사람 끌기도 이 좌표로
    // 둘러보기 도구를 설정 창에 가리지 않는 쪽 가운데에
    const space = Math.round(w - v.left - v.sw - 10 > 40 ? w - (v.left + v.sw) - 10 : 0);
    if (space !== st.panelSpace) { st.panelSpace = space; document.querySelector('.host').style.setProperty('--panel-space', space + 'px'); }
    Render.drawScene(ctx, T, {
      map, view, clock, now: 0,
      special: Render.specialLabels(st.phase === 'setup' ? parseLabels($('labels').value).labels : st.labels),
      mills: map.els.filter(e => e.kind === 'mill').map(el => ({ el, angle: el.speed * clock })),
      movers: map.els.filter(e => e.kind === 'pendulum' || e.kind === 'slider' || e.kind === 'disc').map(el => Object.assign({ el }, Sim.moverPose(el, clock))),
      obstacles: st.obstacles, colorOf, names,
      segs: segsForDraw(), blind: st.setup.blind && st.phase !== 'setup',
      showZone: st.setup.obsPer > 0, showStart: true, showMillRange: true, fx: st.fx,
    });
    Render.drawVignette(ctx, w, h, 0.32);
    Render.drawMinimap(ctx, st.mmRect, { map, view, names: names.map(n => ({ x: n.x, y: n.y, color: n.color })) });
  }

  function drawRace(ctx, w, h, map, clock, now, dt) {
    const g = st.game, live = !!g && st.phase !== 'countdown';
    const names = g ? gameNames() : lobbyNames();
    st.mmRect = map.id === 'short' ? null : mmRectFor(map, w, h);
    // 결승선 띠: 긴 코스에서 본 화면에 결승선이 안 보일 때 아래에 결승선 카메라를 붙인다 (0.4초 넘게 같은 상태일 때만 전환)
    const ih = Math.round(Math.min(h * 0.24, 210)), frac = ih / h;
    if (live && map.id !== 'short' && names.length) {
      // 누군가 결승선 16m 안으로 들어왔는데 본 화면에 결승선이 안 보일 때만 (그 전엔 화면을 다 쓴다)
      const probe = raceView(names, w, h, now, st.inset ? frac : 0, 0);
      const near = names.some(n => n.y > map.F - 16) || st.results.length > 0;
      const want = near && probe.y1 - (probe.y1 - probe.y0) * (st.inset ? frac : 0) < map.F - 0.5;
      if (want !== st.inset) { if (!st.insetSince) st.insetSince = now; if (now - st.insetSince > 400) { st.inset = want; st.insetSince = 0; } }
      else st.insetSince = 0;
    } else { st.inset = false; st.insetSince = 0; }
    st.cam = smooth(st.cam, raceView(names, w, h, now, st.inset ? frac : 0, dt), dt);
    const T = st.T = Render.makeT(w, h, st.cam, 0);
    let countdown = null;
    if (st.phase === 'countdown') { const el = (now - st.countStart) / 1000; countdown = { n: Math.max(1, COUNT_SEC - Math.floor(el)), f: el % 1 }; }
    else if (st.goAt && now - st.goAt < 800) countdown = { n: 0, f: (now - st.goAt) / 800 };
    const shake = st.fx.shake;
    if (shake > 0) { ctx.save(); ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake); }
    const scene = {
      map, view: st.cam, clock, now: g ? g.t : 0, special: g ? st.special : Render.specialLabels(st.labels),
      mills: g ? g.mills.map(m => ({ el: m.el, angle: m.body.getAngle() })) : map.els.filter(e => e.kind === 'mill').map(el => ({ el, angle: el.speed * clock })),
      movers: g ? g.movers.map(m => { const p = m.body.getPosition(); return { el: m.el, x: p.x, y: p.y, a: m.body.getAngle() }; })
        : map.els.filter(e => e.kind === 'pendulum' || e.kind === 'slider' || e.kind === 'disc').map(el => Object.assign({ el }, Sim.moverPose(el, clock))),
      obstacles: g ? [...g.obs.values()] : st.obstacles,
      colorOf, names, leader: live && st.phase === 'running' ? st.leaderId : null,
      trails: live ? [...st.trails.entries()].map(([id, pts]) => ({ color: colorOf(id), pts })) : null,
      segs: segsForDraw(), blind: st.setup.blind,
      showStart: st.phase === 'countdown', fx: st.fx, countdown,
    };
    Render.drawScene(ctx, T, scene);
    if (shake > 0) ctx.restore();
    if (st.inset) drawInset(ctx, w, h, ih, scene);
    Render.drawVignette(ctx, w, h, 0.42);
    if (st.fx.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = Render.alpha(st.fx.flashColor, st.fx.flash * 0.4);
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (st.mmRect) {
      Render.drawMinimap(ctx, st.mmRect, { map, view: st.cam, names: names.map(n => ({ x: n.x, y: n.y, color: n.color, lead: live && n.id === st.leaderId })) });
    }
  }

  // 아래 띠에 결승선 카메라: 안전 영역 폭에 보드 폭 전체, 결승선 위 몇 m부터 칸 이름까지
  function drawInset(ctx, w, h, ih, scene) {
    const { left, right } = safeArea(w), iw = right - left, F = st.map.F, y = h - ih;
    const vh = (C.W + 1.2) * ih / iw, vy1 = F + C.LABEL_BAND + 0.5;
    const view = { x0: -0.6, x1: C.W + 0.6, y0: vy1 - vh, y1: vy1 };
    ctx.save();
    ctx.beginPath(); ctx.rect(left, y, iw, ih); ctx.clip();
    ctx.translate(left, y);
    Render.drawScene(ctx, Render.makeT(iw, ih, view, 0), Object.assign({}, scene, { view, leader: null, countdown: null, keepBudget: true }));
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = Render.alpha(Render.COL.laser, 0.35);
    ctx.fillRect(left, y - 3, iw, 6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = Render.COL.laser;
    ctx.fillRect(left, y - 1, iw, 2);
    ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const label = '결승선';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = Render.COL.laser;
    ctx.fillRect(left + 10, y + 8, tw + 14, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, left + 17, y + 11);
  }

  // ---------- 진행 중 부가 정보 ----------
  function updateTrails() {
    for (const n of st.game.names.values()) {
      if (n.done || !n.body) continue;
      const c = n.body.getWorldCenter();
      let pts = st.trails.get(n.id);
      if (!pts) { pts = []; st.trails.set(n.id, pts); }
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(c.x - last[0], c.y - last[1]) > 0.35) { pts.push([c.x, c.y]); if (pts.length > 9) pts.shift(); }
    }
  }
  function aliveByProgress() {
    const out = [];
    for (const n of st.game.names.values()) if (!n.done && n.body) out.push({ id: n.id, y: n.body.getWorldCenter().y });
    return out.sort((a, b) => b.y - a.y);
  }
  // 카메라가 보는 무리가 새 구간에 들어서면 가운데에 구간 이름을 크게
  function checkStage(alive) {
    if (st.map.stages.length < 2 || !alive.length || st.focusY === null) return;
    const si = Sim.stageAt(st.map, st.focusY);
    if (si > st.stageSeen) {
      st.stageSeen = si;
      showStageTitle(si);
      st.fx.screen(Render.themeOf(si).glow, 0.18);
      Render.Sound.play('stage');
    }
  }
  // 순위판: 도착한 이름(칸 이름과 함께) 다음에 아직 떨어지는 이름을 지금 위치 순서로. 전원을 보여준다
  function renderLiveRank(alive) {
    const rows = [], multi = st.map.stages.length > 1;
    st.results.forEach((r, i) => rows.push({ rk: i + 1, name: r.name, color: r.color, note: r.label, cls: st.special.has(r.label) ? 'done win' : 'done' }));
    alive.forEach((a, i) => {
      const p = byId(a.id);
      rows.push({ rk: st.results.length + i + 1, name: p ? p.name : '?', color: p ? p.color : Render.COL.chrome, note: multi ? `${Sim.stageAt(st.map, a.y) + 1}구간` : '', cls: i === 0 ? 'lead' : '' });
    });
    const ul = $('liveRank'), frag = document.createDocumentFragment();
    ul.classList.toggle('compact', rows.length > 18);
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.cls) li.className = r.cls;
      li.style.setProperty('--c', r.color);
      li.innerHTML = '<span class="rk"></span><span class="nm"></span><span class="st"></span>';
      li.children[0].textContent = r.rk;
      li.children[1].textContent = r.name;
      li.children[2].textContent = r.note;
      frag.appendChild(li);
    }
    ul.replaceChildren(frag);
    show('liveWrap', rows.length > 0);
  }
  // 폰에 1초마다 내 순위·진행도만 보낸다 (위치 스트리밍은 하지 않음)
  function sendProgress(alive) {
    const done = st.results.length, F = st.map.F;
    alive.forEach((a, i) => {
      const p = byId(a.id);
      if (p && p.conn) send(p, { t: 'prog', p: r3(Math.max(0, Math.min(1, a.y / F))), r: done + i + 1, s: Sim.stageAt(st.map, a.y), n: st.parts.length });
    });
  }

  // ---------- 메인 루프 ----------
  let last = 0;
  function frame(ts) {
    const now = ts || performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    const t0 = performance.now();
    try { tick(dt, now); } catch (e) { console.error(e); }
    // 성능 점검용: 이 프레임에 우리 코드가 쓴 시간 (40ms 넘으면 기록)
    const ms = performance.now() - t0, s = st.stats;
    if (st.phase === 'running') { s.tickSum = (s.tickSum || 0) + ms; s.tickN = (s.tickN || 0) + 1; }
    if (ms > 40 && (s.slowTicks = s.slowTicks || []).length < 20) s.slowTicks.push([Math.round(ms), st.phase, st.game ? +st.game.t.toFixed(2) : 0]);
    requestAnimationFrame(frame);
  }
  function tick(dt, now) {
    if (st.phase === 'countdown') {
      const el = (now - st.countStart) / 1000, n = Math.floor(el);
      if (n !== st.lastCount && n < COUNT_SEC) { st.lastCount = n; Render.Sound.play('tick'); }
      if (el >= COUNT_SEC && st.game) {
        st.phase = 'running';
        st.acc = 0;
        st.goAt = now;
        Render.Sound.play('go');
        showPanel();
      }
    }
    const g = st.game;
    if (st.phase === 'running' && g && !g.over) {
      st.acc += dt * st.speed * (slowMo(g) ? 0.4 : 1);
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
      updateTrails();
      const alive = aliveByProgress();
      st.leaderId = alive.length ? alive[0].id : null;
      checkStage(alive);
      if (now - st.liveAt > 250) { st.liveAt = now; renderLiveRank(alive); }
      if (now - st.progAt > 1000) { st.progAt = now; sendProgress(alive); }
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
      if (y > g.F - 2.5 && y < g.F) return true;
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
    // 미니맵: 진행 중이면 4초 동안 그쪽을 보고, 시작 전이면 그곳으로 간다
    const onMinimap = (px, py) => {
      const r = st.mmRect;
      return r && st.phase !== 'countdown' && px >= r.x - 8 && px <= r.x + r.w + 8 && py >= r.y - 8 && py <= r.y + r.h + 8;
    };
    const lookAt = py => {
      const y = Render.minimapGeom(mapNow(), st.mmRect).toY(py);
      if (racing()) st.manual = { y, until: performance.now() + 4000 };
      else { stopTour(); look.cy = y; hideHint(); }
    };
    cv.addEventListener('pointerdown', e => {
      const [px, py] = pt(e);
      if (onMinimap(px, py)) { st.drag = { mm: true }; lookAt(py); cv.setPointerCapture(e.pointerId); return; }
      const hit = hitLocal(px, py);
      if (hit) {
        st.drag = { id: hit.n.id, off: hit.off };
      } else if (!racing() && look.cur && st.T) {
        // 빈 곳을 끌면 화면이 따라 움직인다
        stopTour();
        st.drag = { pan: true, px, py, cx: look.cur.cx, cy: look.cur.cy };
      } else return;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', e => {
      const [px, py] = pt(e);
      const d = st.drag;
      if (d && d.mm) { lookAt(py); return; }
      if (d && d.pan) {
        const k = st.T.k;
        look.cy = d.cy - (py - d.py) / k;
        look.cx = d.cx - (px - d.px) / k;
        Object.assign(look.cur, { cy: look.cy, cx: look.zoomW >= C.W + 1.2 ? look.cur.cx : look.cx });
        if (Math.abs(py - d.py) + Math.abs(px - d.px) > 6) hideHint();
        return;
      }
      if (d) {
        const p = byId(d.id);
        if (p) { p.x = Sim.clampDropX(r2(st.T.mx(px) - d.off), p.w); scheduleLobby(); }
      } else cv.style.cursor = onMinimap(px, py) ? 'pointer' : hitLocal(px, py) ? 'grab' : racing() ? '' : 'grab';
    });
    const end = () => { if (st.drag) { st.drag = null; cv.style.cursor = ''; } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    // 휠: 위아래로 굴리기, Ctrl(⌘)+휠: 확대·축소 (시작 전에만)
    cv.addEventListener('wheel', e => {
      if (racing() || !look.cur || !st.T) return;
      e.preventDefault();
      stopTour();
      hideHint();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cv.clientHeight : 1;
      const dy = Math.max(-400, Math.min(400, e.deltaY * unit));
      if (e.ctrlKey || e.metaKey) { const [px, py] = pt(e); zoomBy(Math.exp(dy * 0.0016), px, py); }
      else look.cy = (look.cy === null ? look.cur.cy : look.cy) + dy * 1.15 / st.T.k;
    }, { passive: false });
  }
  // 둘러보는 법 안내는 한 번 움직여 보면 숨긴다 (다음에 열어도 안 보임)
  function hideHint() {
    const el = $('lookHint');
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    ls.set('plb.lookHint', 1);
  }

  // ---------- 버튼 ----------
  function bindUI() {
    const ta = $('labels');
    ta.value = st.setup.labels;
    $('obsOut').textContent = st.setup.obsPer;
    $('blind').checked = !!st.setup.blind;
    renderSetupHint();
    const saveSetup = () => ls.set('plb.setup', { labels: ta.value, obsPer: +$('obsOut').textContent, blind: $('blind').checked, course: st.courseSel });
    const pickCourse = id => {
      st.courseSel = id === 'short' ? 'short' : 'long';
      for (const b of $('coursePick').children) { const on = b.dataset.course === st.courseSel; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
    };
    pickCourse(st.courseSel);
    for (const b of $('coursePick').children) b.onclick = () => { pickCourse(b.dataset.course); st.cam = null; resetLook(); saveSetup(); };
    ta.addEventListener('input', () => { renderSetupHint(); $('setupErr').textContent = ''; saveSetup(); });
    const step = d => { $('obsOut').textContent = Math.max(0, Math.min(5, +$('obsOut').textContent + d)); saveSetup(); };
    $('obsMinus').onclick = () => step(-1);
    $('obsPlus').onclick = () => step(1);
    $('blind').onchange = saveSetup;

    $('openRoom').onclick = () => {
      const parsed = renderSetupHint();
      if (parsed.err) { $('setupErr').textContent = parsed.err; return; }
      const prevLabels = st.labels.join('\n'), prevBlind = st.setup.blind, prevObs = st.setup.obsPer;
      st.setup = { labels: ta.value, obsPer: +$('obsOut').textContent, blind: $('blind').checked, course: st.courseSel };
      st.map = mapOf(st.courseSel);
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
    $('cancelEdit').onclick = () => { st.courseSel = st.map.id; pickCourse(st.courseSel); st.phase = 'lobby'; showPanel(); scheduleLobby(); };
    $('editSetup').onclick = () => {
      st.courseSel = st.map.id;
      pickCourse(st.courseSel);
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
    // 설정 창 접기·펼치기
    $('foldBtn').onclick = () => { st.folded = true; showPanel(); };
    $('panelPill').onclick = () => { st.folded = false; showPanel(); };
    // 코스 둘러보기 도구
    const zoomCenter = f => { const g = look.geo, cv = $('board'); if (g) zoomBy(f, g.left + g.sw / 2, (g.vTop + g.vBot) / 2); else if (cv) zoomBy(f, cv.clientWidth / 2, cv.clientHeight / 2); };
    $('zoomIn').onclick = () => { stopTour(); zoomCenter(1 / 1.25); };
    $('zoomOut').onclick = () => { stopTour(); zoomCenter(1.25); };
    $('tourBtn').onclick = () => {
      if (look.tour) { stopTour(); return; }
      look.zoomW = null; look.cx = null;   // 둘러보기는 보드 폭 전체로
      look.tour = { t0: performance.now() };
      hideHint();
      renderLookTools();
    };
    if (ls.get('plb.lookHint')) $('lookHint').classList.add('hidden');
    $('camBtn').onclick = () => {
      st.follow = !st.follow;
      $('camBtn').textContent = st.follow ? '따라가기' : '전체 보기';
    };
    $('speedBtn').onclick = () => {
      st.speed = st.speed === 1 ? 2 : 1;
      $('speedBtn').textContent = st.speed === 1 ? '1배속' : '2배속';
      $('speedBtn').classList.toggle('on', st.speed === 2);
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
      st.setup.course = saved.course === 'short' ? 'short' : 'long';
    }
    st.map = mapOf(st.setup.course); st.courseSel = st.map.id;
    if (!restoreRoom()) st.labels = parseLabels(st.setup.labels).labels;
    bindUI();
    bindBoard();
    showPanel();
    if (st.roomOpen) scheduleLobby();
    requestAnimationFrame(frame);
    root.PLB = { st, look, parseLabels, lobbyMsg: () => lobbyFor({}, lobbyBase(), true) };   // 테스트·디버깅용
  }

  root.Host = { start, parseLabels };
})(typeof self !== 'undefined' ? self : this);
