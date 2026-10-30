/* 핀볼 사다리 — 참가자(폰) 화면: 연결 → 이름 → 출발 위치·장애물 → 준비 → 결과
 * 폰은 입력만 보내는 컨트롤러다. 여기서 하는 검증은 즉각적인 피드백용이고, 최종 판정은 호스트가 한다.
 */
(function (root) {
  'use strict';
  const Sim = root.Sim, C = Sim.C, Glyph = root.Glyph, Render = root.Render, Net = root.Net;
  const maps = {};
  const mapOf = id => maps[id] || (maps[id] = Sim.buildMap(id === 'short' ? 'short' : 'long'));
  const $ = id => document.getElementById(id);
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const SECTIONS = ['pConnecting', 'pError', 'pName', 'pLobby', 'pRun', 'pDone'];
  const KIND_LABEL = { block: '벽돌', tramp: '트램펄린', bumper: '범퍼' };
  const STEP = Math.PI / 12;   // 회전 15°
  const lsGet = k => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* 저장 안 됨 */ } };

  const st = {
    code: '', cid: '', net: null, screen: 'pConnecting',
    me: { id: null, name: null, color: null },
    phase: 'lobby', obsPer: 2, map: mapOf('long'), players: [], obstacles: [], labels: [], fontKey: '',
    myX: null, movedAt: 0, dropSentAt: 0, dropTimer: null,
    ready: false, readyAt: 0, inGame: false, result: null,
    tab: 'drop', kind: 'block', edit: null, editOk: false, pending: null, lidSeq: 0,
    T: null, dirty: true, ptr: null,
    obsTop: null, lastView: null, strip: null, lastLoop: 0,   // 장애물 탭의 코스 둘러보기 (긴 코스)
  };

  function getCid() {
    let cid = lsGet('plb.cid');
    if (!cid || !/^[\w-]{6,40}$/.test(cid)) {
      const a = new Uint8Array(9);
      if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else a.forEach((_, i) => { a[i] = Math.random() * 256; });
      cid = Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
      lsSet('plb.cid', cid);
    }
    return cid;
  }

  // ---------- 화면 전환 ----------
  function show(id) {
    for (const s of SECTIONS) $(s).classList.toggle('hidden', s !== id);
    st.screen = id;
    st.dirty = true;
  }
  function showError(msg, canRetry) {
    $('pErrMsg').textContent = msg;
    $('pRetry').classList.toggle('hidden', !canRetry);
    show('pError');
  }
  function renderMe() {
    const on = !!st.me.name;
    $('pMe').classList.toggle('hidden', !on);
    $('pMeName').textContent = st.me.name || '';
    for (const id of ['pMe', 'pRunMe', 'pDoneMe']) $(id).style.setProperty('--c', st.me.color || Render.COL.teal);
    $('pRunMe').textContent = st.me.name || '';
    $('pDoneMe').textContent = st.me.name || '';
  }
  function showName() {
    const input = $('pNameInput');
    if (!input.value) input.value = lsGet('plb.name') || '';
    $('pNameBtn').disabled = false;
    show('pName');
  }
  function showLobby() {
    renderTabs(); renderMyObs(); renderReady();
    show('pLobby');
  }
  function setCourse(id) {
    if (!id || id === st.map.id) return;
    st.map = mapOf(id);
    st.dirty = true;
  }
  function showRun(msg) {
    $('pRunMsg').textContent = msg || '이름이 떨어지는 중이에요';
    $('pRace').classList.add('hidden');
    show('pRun');
  }
  function showDone(label, order) {
    $('pLabel').textContent = label;
    $('pDoneMsg').textContent = order ? `${order}번째로 결승선을 통과했어요` : '';
    show('pDone');
  }

  // ---------- 연결 ----------
  function connect() {
    $('pConnMsg').textContent = '방에 연결하는 중…';
    show('pConnecting');
    st.net = new Net.ClientNet(st.code, {
      onStatus(level, text) { const el = $('pNet'); el.className = 'net ' + level; el.textContent = text; },
      onOpen() { st.net.send({ t: 'hello', cid: st.cid }); },
      onData,
      onFail(kind) {
        st.net.stop();
        if (kind === 'browser') showError('이 브라우저는 지원하지 않아요. 크롬이나 사파리로 열어주세요.', false);
        else showError('방을 찾을 수 없어요. 방코드가 맞는지, 큰 화면에서 방이 열려 있는지 확인해주세요.', true);
      },
    });
  }

  function onData(m) {
    switch (m.t) {
      case 'welcome':
        setCourse(m.course);
        st.me.id = m.id; st.me.color = m.color; st.me.name = m.name || null;
        st.obsPer = m.obsPer | 0; st.phase = m.phase; st.inGame = !!m.inGame;
        if (Date.now() - st.readyAt > 1500) st.ready = !!m.ready;
        if (st.myX === null || Date.now() - st.movedAt > 1500) st.myX = m.x;
        if (m.code) $('pCode').textContent = m.code;
        renderMe();
        if (!st.me.name) showName();
        else if (m.result) showDone(m.result.label, m.result.order);
        else if (m.phase === 'running') showRun(st.inGame ? '' : '다음 판부터 참여해요. 지금은 큰 화면으로 구경해주세요');
        else if (m.phase === 'done') showRun('이번 판이 끝났어요. 다음 판을 기다려주세요');
        else showLobby();
        break;
      case 'name-ok':
        st.me.name = m.name; st.me.color = m.color;
        lsSet('plb.name', m.name);
        renderMe();
        if (st.phase === 'lobby') showLobby();
        else showRun('다음 판부터 참여해요. 지금은 큰 화면으로 구경해주세요');
        break;
      case 'name-bad':
        $('pNameErr').textContent = m.reason || '이 이름은 쓸 수 없어요';
        $('pNameBtn').disabled = false;
        break;
      case 'lobby': applyLobby(m); break;
      case 'obs-ok':
        if (m.op === 'put' && st.pending && st.pending.lid === m.id) {
          // 대기실 갱신이 오기 전에 내 목록에 먼저 반영 (다음 고스트가 방금 놓은 자리에 생기지 않게)
          const id = st.me.id + ':' + m.id, o = Object.assign({ id, owner: st.me.id }, st.pending.o);
          st.obstacles = st.obstacles.filter(q => q.id !== id).concat([o]);
          st.pending = null;
          st.edit = null;
          const n = myObs().length;
          Render.toast(n < st.obsPer ? `설치했어요 (${n}/${st.obsPer})` : '설치했어요', 'ok', 1600);
          if (n < st.obsPer) newEdit();
          else setStatus('다 놓았어요. 옮기려면 보드에서 내 장애물을 탭하세요', 'ok');
          renderMyObs();
        }
        break;
      case 'obs-bad':
        if (st.pending && st.pending.lid === m.id) st.pending = null;
        setStatus(m.reason || '여기에는 놓을 수 없어요', 'bad');
        break;
      case 'start':
        setCourse(m.course);
        st.phase = 'running'; st.inGame = true; st.result = null;
        showRun();
        break;
      case 'prog': {
        // 1초마다 오는 내 순위·진행도
        if (st.screen !== 'pRun' || st.result) break;
        const stage = st.map.stages[m.s];
        $('pRace').classList.remove('hidden');
        $('pRace').style.setProperty('--c', st.me.color || Render.COL.amber);
        $('pRunRank').textContent = m.r + '등';
        $('pRunStage').textContent = st.map.stages.length > 1 && stage ? `${m.s + 1}구간 ${stage.name}` : '';
        $('pRunBar').style.width = Math.round(Math.max(0, Math.min(1, m.p)) * 100) + '%';
        $('pRunMsg').textContent = `${m.n}명 중 지금 ${m.r}등으로 떨어지는 중이에요`;
        break;
      }
      case 'mine':
        st.result = m;
        showDone(m.label, m.order);
        try { if (navigator.vibrate) navigator.vibrate([60, 40, 120]); } catch (e) { /* 무시 */ }
        break;
      case 'end': {
        st.phase = 'done';
        if (st.result) break;
        // mine을 놓쳤어도 전체 결과에서 내 이름을 찾는다
        const i = (m.results || []).findIndex(r => r.name === st.me.name);
        if (i >= 0 && st.inGame) { st.result = { label: m.results[i].label, order: i + 1 }; showDone(st.result.label, st.result.order); }
        else showRun(st.inGame ? '결과를 받지 못했어요. 큰 화면을 확인해주세요' : '이번 판이 끝났어요. 다음 판을 기다려주세요');
        break;
      }
      case 'lobby-again':
        st.phase = 'lobby'; st.ready = false; st.readyAt = 0; st.result = null; st.inGame = false;
        st.edit = null; st.pending = null;
        if (st.me.name) showLobby(); else showName();
        break;
      case 'kicked':
        st.net.stop();
        showError('호스트가 내보냈어요.', false);
        break;
      case 'full':
        st.net.stop();
        showError(`방이 꽉 찼어요 (최대 ${C.MAX_PLAYERS}명).`, true);
        break;
    }
  }

  function applyLobby(m) {
    setCourse(m.course);
    st.obsPer = m.obsPer | 0;
    st.players = (m.players || []).map(a => ({
      id: a[0], name: a[1], color: a[2], x: a[3], w: a[4], fontM: a[5],
      ready: !!(a[6] & 1), online: !!(a[6] & 2), local: !!(a[6] & 4), nObs: a[7],
    }));
    if (m.obstacles) st.obstacles = m.obstacles.map(a => ({ id: a[0], owner: String(a[0]).split(':')[0], kind: a[1], x: a[2], y: a[3], a: a[4] }));
    if (m.labels) st.labels = m.labels;
    const me = st.players.find(p => p.id === st.me.id);
    if (me) {
      // 방금 내가 바꾼 값은 호스트 값이 따라올 때까지 내 것을 유지
      if (Date.now() - st.movedAt > 600) st.myX = me.x;
      if (Date.now() - st.readyAt > 1500) st.ready = me.ready;
      st.me.color = me.color;
    }
    if (st.edit && st.edit.lid && !st.obstacles.some(o => o.id === st.me.id + ':' + st.edit.lid)) st.edit = null;
    if (st.obsPer === 0 && st.tab === 'obs') setTab('drop');
    const key = st.players.map(p => p.name).join('');
    if (key !== st.fontKey) { st.fontKey = key; Glyph.loadFont(key).then(() => { st.dirty = true; }); }
    renderMe();
    renderTabs(); renderMyObs(); renderReady();
    if (st.edit) validateEdit();
    st.dirty = true;
  }

  // ---------- 출발 위치 ----------
  const myW = () => { const me = st.players.find(p => p.id === st.me.id); return me ? me.w : 1; };
  function setMyX(x) {
    st.myX = Sim.clampDropX(r2(x), myW());
    st.movedAt = Date.now();
    st.dirty = true;
    sendDrop();
  }
  function sendDrop() {
    const now = Date.now(), wait = 100 - (now - st.dropSentAt);
    if (wait <= 0) { st.dropSentAt = now; st.net.send({ t: 'drop', x: st.myX }); }
    else if (!st.dropTimer) st.dropTimer = setTimeout(() => { st.dropTimer = null; sendDrop(); }, wait);
  }
  function layoutPositions() {
    return Sim.layoutStart(st.players.map(p => ({ id: p.id, x: p.id === st.me.id && st.myX !== null ? st.myX : p.x, w: p.w })));
  }

  // ---------- 장애물 ----------
  const lidOf = o => String(o.id).split(':')[1];
  const myObs = () => st.obstacles.filter(o => o.owner === st.me.id);
  function setStatus(text, kind) {
    const el = $('pObsStatus');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function defaultAngle(kind) { return kind === 'block' ? STEP : 0; }
  // 지금 보고 있는 화면 가운데에서 가까운 빈자리 (장애물은 맵 어디든 놓을 수 있다)
  function freeSpot(kind, a) {
    const list = st.obstacles, tries = [], v = obsScroll() && st.lastView;
    const cy = v ? (v.y0 + v.y1) / 2 : 17;
    const y0 = v ? Math.max(C.ZONE.y0 + 1, v.y0 + 1) : 4.5, y1 = v ? Math.min(st.map.F - 3, v.y1 - 1) : 28.5;
    for (let y = y0; y <= y1; y += 0.5) for (let x = 1.5; x <= 28.5; x += 0.5) tries.push([x, y]);
    tries.sort((p, q) => Math.hypot(p[0] - 15, (p[1] - cy) * 1.4) - Math.hypot(q[0] - 15, (q[1] - cy) * 1.4));
    for (const [x, y] of tries) {
      if (Sim.validateObstacle(st.map, list, { id: '__new', kind, x, y, a }).ok) return [x, y];
    }
    return null;
  }
  function newEdit() {
    if (myObs().length >= st.obsPer) { st.edit = null; return; }
    const a = defaultAngle(st.kind), spot = freeSpot(st.kind, a);
    if (!spot) {
      st.edit = null;
      setStatus(`이 화면에는 ${KIND_LABEL[st.kind]} 놓을 빈자리가 없어요. 다른 곳으로 가 보세요`, 'bad');
      st.dirty = true;
      return;
    }
    st.edit = { lid: null, kind: st.kind, x: spot[0], y: spot[1], a };
    validateEdit();
  }
  function editExisting(o) {
    if (obsScroll()) scrollTo(o.y);   // 고른 장애물이 보이게
    st.edit = { lid: lidOf(o), kind: o.kind, x: o.x, y: o.y, a: o.a };
    st.kind = o.kind;
    renderKinds(); renderMyObs();
    validateEdit();
    setStatus('끌어서 옮기거나 돌린 다음 "여기에 설치"를 누르세요');
  }
  function validateEdit() {
    const e = st.edit;
    st.dirty = true;
    if (!e) { st.editOk = false; return { ok: false }; }
    const v = Sim.validateObstacle(st.map, st.obstacles, { id: e.lid ? st.me.id + ':' + e.lid : '__new', kind: e.kind, x: e.x, y: e.y, a: e.a });
    st.editOk = v.ok;
    if (v.ok) setStatus(e.lid ? '이 자리로 옮길 수 있어요' : '여기에 놓을 수 있어요', 'ok');
    else setStatus(v.reason, 'bad');
    return v;
  }
  function hitMyObs(m) {
    let best = null, bd = 0.6;
    for (const o of myObs()) {
      const g = Sim.obsGeom(o);
      const d = g.t === 'cir' ? Math.hypot(m[0] - g.c[0], m[1] - g.c[1]) - g.r : segDist(g.a, g.b, m) - g.r;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function segDist(a, b, p) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
    return Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
  }
  function setKind(kind) {
    st.kind = kind;
    if (st.edit) {
      st.edit.kind = kind;
      let a = st.edit.a;
      if (kind === 'block' && Math.abs(Math.sin(a)) < Math.sin(14 * Math.PI / 180)) a = STEP;
      if (kind === 'tramp' && Math.abs(Math.sin(a)) > Math.sin(46 * Math.PI / 180)) a = 0;
      st.edit.a = r3(Sim.normAngle(kind, a));
      validateEdit();
    } else newEdit();
    renderKinds();
  }
  function rotate(dir) {
    if (!st.edit || st.edit.kind === 'bumper') return;
    st.edit.a = r3(Sim.normAngle(st.edit.kind, st.edit.a + dir * STEP));
    validateEdit();
  }
  function place() {
    const e = st.edit;
    if (!e) { setStatus(myObs().length >= st.obsPer ? `장애물은 ${st.obsPer}개까지예요. 옮기려면 내 장애물을 탭하세요` : '보드를 탭해서 놓을 자리를 고르세요', 'bad'); return; }
    if (!e.lid && myObs().length >= st.obsPer) { setStatus(`장애물은 ${st.obsPer}개까지예요`, 'bad'); return; }
    e.x = r2(e.x); e.y = r2(e.y); e.a = r3(e.a);
    if (!validateEdit().ok) return;
    const lid = e.lid || 'o' + (++st.lidSeq) + Math.random().toString(36).slice(2, 6);
    st.pending = { lid, o: { kind: e.kind, x: e.x, y: e.y, a: e.a } };
    st.net.send({ t: 'obs', op: 'put', id: lid, kind: e.kind, x: e.x, y: e.y, a: e.a });
    setStatus('확인 중…');
  }
  function removeObs(o) {
    const lid = lidOf(o);
    st.net.send({ t: 'obs', op: 'del', id: lid });
    st.obstacles = st.obstacles.filter(q => q !== o);
    if (st.edit && st.edit.lid === lid) st.edit = null;
    if (!st.edit) newEdit();
    renderMyObs(); renderTabs();
    st.dirty = true;
  }

  // ---------- 패널 ----------
  function setTab(tab) {
    st.tab = tab === 'obs' && st.obsPer > 0 ? 'obs' : 'drop';
    for (const b of $('pTabs').children) b.classList.toggle('on', b.dataset.tab === st.tab);
    $('pDropTools').classList.toggle('hidden', st.tab !== 'drop');
    $('pObsTools').classList.toggle('hidden', st.tab !== 'obs');
    if (st.tab === 'obs' && !st.edit) newEdit();
    if (st.tab === 'obs' && st.edit) validateEdit();
    if (st.tab === 'obs' && !st.edit) setStatus('옮기려면 보드에서 내 장애물을 탭하세요');
    st.dirty = true;
  }
  function renderTabs() {
    const tabs = $('pTabs'), obsBtn = tabs.querySelector('[data-tab="obs"]');
    obsBtn.textContent = `장애물 (${myObs().length}/${st.obsPer})`;
    obsBtn.classList.toggle('hidden', st.obsPer === 0);
    tabs.classList.toggle('single', st.obsPer === 0);
  }
  function renderKinds() {
    for (const b of $('pKinds').children) b.classList.toggle('on', b.dataset.kind === st.kind);
    const bump = st.edit && st.edit.kind === 'bumper';
    $('pRotL').disabled = bump; $('pRotR').disabled = bump;
  }
  function renderMyObs() {
    const ul = $('pMyObs');
    ul.innerHTML = '';
    myObs().forEach((o, i) => {
      const li = document.createElement('li');
      if (st.edit && st.edit.lid === lidOf(o)) li.className = 'sel';
      const label = document.createElement('span');
      label.textContent = `${KIND_LABEL[o.kind]} ${i + 1}`;
      const del = document.createElement('button');
      del.className = 'btn'; del.type = 'button'; del.textContent = '삭제';
      del.onclick = ev => { ev.stopPropagation(); removeObs(o); };
      li.onclick = () => editExisting(o);
      li.append(label, del);
      ul.appendChild(li);
    });
    renderTabs();
    renderKinds();
  }
  function renderReady() {
    const b = $('pReady');
    b.classList.toggle('on', st.ready);
    b.textContent = st.ready ? '준비됨 (다시 누르면 취소)' : '준비 완료';
  }

  // ---------- 보드 ----------
  // 장애물 탭 + 긴 코스: 코스 전체를 위아래로 둘러보며 놓는다. 보드는 캔버스 왼쪽, 오른쪽 띠(STRIP px)는 코스 전체.
  // 띠를 누르거나 끌면 그 높이로 가고, 장애물을 끌다가 위·아래 끝에 닿으면 저절로 넘어간다. 짧은 코스는 한 화면에 다 들어와서 그대로
  const STRIP = 46;
  const obsScroll = () => st.tab === 'obs' && st.map.id !== 'short';
  const scrollRange = H => [C.ZONE.y0 - 4, st.map.F + C.LABEL_BAND + 0.8 - H];
  function obsView(w, h) {
    const k = (w - STRIP) / (C.W + 1.2), H = h / k, [lo, hi] = scrollRange(H);
    if (st.obsTop === null) st.obsTop = lo;
    st.obsTop = Math.max(lo, Math.min(hi, st.obsTop));
    return { x0: -0.6, x1: -0.6 + w / k, y0: st.obsTop, y1: st.obsTop + H, H };
  }
  function scrollTo(y) {   // 그 높이가 화면 가운데에 오게
    const cv = $('pCanvas'), w = cv.clientWidth || 360, h = cv.clientHeight || 420;
    st.obsTop = y - (h * (C.W + 1.2) / Math.max(1, w - STRIP)) / 2;
    st.dirty = true;
  }
  function view() {
    const pos = layoutPositions();
    let top = C.START_Y;
    for (const id in pos) top = Math.min(top, pos[id].y);
    const y1 = st.map.id === 'short' ? C.VIEW.y1 : Render.LOBBY.finish + C.LABEL_BAND + 0.7;
    return { x0: C.VIEW.x0, x1: C.VIEW.x1, y0: Math.min(C.VIEW.y0, top - 1.3), y1 };
  }
  function draw() {
    const cv = $('pCanvas'), scroll = obsScroll();
    let v = scroll ? null : view();
    const ar = scroll ? '100 / 118' : `${(v.x1 - v.x0).toFixed(2)} / ${(v.y1 - v.y0).toFixed(2)}`;
    if (cv.dataset.ar !== ar) { cv.dataset.ar = ar; cv.style.aspectRatio = ar; }
    const { ctx, w, h } = Render.setupCanvas(cv);
    if (scroll) v = st.lastView = obsView(w, h);
    $('pStripHint').classList.toggle('hidden', st.map.id === 'short');
    const T = st.T = Render.makeT(w, h, v, 0);
    const pos = layoutPositions(), obsTab = st.tab === 'obs';
    const editingId = st.edit && st.edit.lid ? st.me.id + ':' + st.edit.lid : null;
    const colorOf = id => { const p = st.players.find(q => q.id === id); return p ? p.color : Render.COL.chrome; };
    const segW = C.W / Math.max(1, st.labels.length);
    const mine = pos[st.me.id];
    const map = st.map, cut = map.id !== 'short' && !scroll;
    Render.drawScene(ctx, T, {
      map, view: v, mode: 'lobby',
      mills: map.els.filter(e => e.kind === 'mill').map(el => ({ el, angle: Math.PI / 4 })),
      finishAt: cut ? Render.LOBBY.finish : undefined,
      cut: cut ? Object.assign({ text: Render.cutText(map) }, Render.LOBBY.cut) : null,
      obstacles: st.obstacles.filter(o => o.id !== editingId), colorOf,
      names: st.players.filter(p => pos[p.id]).map(p => ({
        id: p.id, text: p.name, color: p.color, x: pos[p.id].x, y: pos[p.id].y, fontM: p.fontM, w: p.w, me: p.id === st.me.id,
      })),
      segs: st.labels.map(label => ({ label, w: segW, closed: false })),
      special: Render.specialLabels(st.labels),
      showZone: obsTab, showStart: true, showMillRange: obsTab, halo: obsTab,
      ghost: obsTab && st.edit ? Object.assign({ ok: st.editOk }, st.edit) : null,
      guide: !obsTab && mine ? { x: mine.x, y: mine.y } : null,
    });
    // 코스 띠: 코스 전체 + 지금 보는 곳 + 내 장애물(내 색)·놓으려는 것(앰버)
    if (scroll) {
      st.strip = { x: w - STRIP + 6, y: 6, w: STRIP - 10, h: h - 12, stretch: true };
      const dots = myObs().map(o => ({ x: o.x, y: o.y, color: st.me.color || Render.COL.teal }));
      if (st.edit) dots.push({ x: st.edit.x, y: st.edit.y, color: Render.COL.amber, lead: true });
      Render.drawMinimap(ctx, st.strip, { map, view: v, names: dots });
    } else st.strip = null;
  }
  function loop(ts) {
    const now = ts || performance.now(), dt = Math.min(0.05, Math.max(0, (now - (st.lastLoop || now)) / 1000));
    st.lastLoop = now;
    if (Render.Assets.rev !== st.assetRev) { st.assetRev = Render.Assets.rev; st.dirty = true; }   // 바닥 그림이 도착하면 다시 그림
    // 장애물을 끌다가 화면 위·아래 끝에 닿으면 그쪽으로 저절로 넘어간다 (장애물도 같이)
    const p = st.ptr;
    if (p && !p.strip && p.moved && obsScroll() && st.edit && p.edit && st.lastView && p.lastPy !== undefined) {
      const h = $('pCanvas').clientHeight, edge = h * 0.12, dir = p.lastPy > h - edge ? 1 : p.lastPy < edge ? -1 : 0;
      if (dir) {
        const [lo, hi] = scrollRange(st.lastView.H), before = st.obsTop;
        st.obsTop = Math.max(lo, Math.min(hi, st.obsTop + dir * 14 * dt));
        const d = st.obsTop - before;
        if (d) { p.edit.y += d; st.edit.y = r2(st.edit.y + d); validateEdit(); }
      }
    }
    if (st.screen === 'pLobby' && st.dirty) {
      st.dirty = false;
      try { draw(); } catch (e) { console.error(e); }
    }
    requestAnimationFrame(loop);
  }

  function bindCanvas() {
    const cv = $('pCanvas');
    const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const stripTo = py => scrollTo(Render.minimapGeom(st.map, st.strip).toY(py));
    cv.addEventListener('pointerdown', e => {
      if (!st.T) draw();   // 첫 프레임 전에 눌러도 좌표 변환이 있도록
      const [px, py] = pt(e), m = [st.T.mx(px), st.T.my(py)];
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (st.strip && px >= st.strip.x - 8) { st.ptr = { id: e.pointerId, strip: true }; stripTo(py); e.preventDefault(); return; }
      st.ptr = {
        id: e.pointerId, px, py, m, moved: false, startX: st.myX,
        edit: st.edit ? { x: st.edit.x, y: st.edit.y } : null,
        hit: st.tab === 'obs' ? hitMyObs(m) : null,
      };
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      const p = st.ptr;
      if (!p || p.id !== e.pointerId) return;
      const [px, py] = pt(e);
      if (p.strip) { stripTo(py); return; }
      const dx = px - p.px, dy = py - p.py;
      p.lastPy = py;
      if (!p.moved && Math.hypot(dx, dy) < 7) return;
      p.moved = true;
      const k = st.T.k;
      if (st.tab === 'drop') setMyX((p.startX === null ? C.W / 2 : p.startX) + dx / k);
      else if (st.edit && p.edit) {
        // 손가락에 가리지 않게 이동량만큼 상대 이동
        st.edit.x = r2(p.edit.x + dx / k);
        st.edit.y = r2(p.edit.y + dy / k);
        validateEdit();
      }
    });
    const up = e => {
      const p = st.ptr;
      if (!p || p.id !== e.pointerId) return;
      st.ptr = null;
      if (p.strip || p.moved) return;
      if (st.tab === 'drop') { setMyX(p.m[0]); return; }
      if (p.hit) { editExisting(p.hit); return; }
      if (!st.edit) {
        if (myObs().length >= st.obsPer) { setStatus(`장애물은 ${st.obsPer}개까지예요. 옮기려면 내 장애물을 탭하세요`, 'bad'); return; }
        newEdit();
      }
      if (st.edit) { st.edit.x = r2(p.m[0]); st.edit.y = r2(p.m[1]); validateEdit(); renderMyObs(); }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { st.ptr = null; });
    root.addEventListener('resize', () => { st.dirty = true; });
  }

  function bindUI() {
    $('pNameForm').onsubmit = e => {
      e.preventDefault();
      const name = $('pNameInput').value.replace(/\s+/g, ' ').trim();
      if (!name) { $('pNameErr').textContent = '이름을 적어주세요'; return; }
      if (Array.from(name).length > C.NAME_MAX_CHARS) { $('pNameErr').textContent = `이름은 ${C.NAME_MAX_CHARS}글자까지예요`; return; }
      $('pNameErr').textContent = '';
      $('pNameBtn').disabled = true;
      setTimeout(() => { $('pNameBtn').disabled = false; }, 5000);
      st.net.send({ t: 'name', name });
    };
    $('pRetry').onclick = () => { if (st.net) st.net.stop(); connect(); };
    for (const b of $('pTabs').children) b.onclick = () => setTab(b.dataset.tab);
    $('pLeft').onclick = () => setMyX((st.myX === null ? C.W / 2 : st.myX) - 0.25);
    $('pRight').onclick = () => setMyX((st.myX === null ? C.W / 2 : st.myX) + 0.25);
    for (const b of $('pKinds').children) b.onclick = () => setKind(b.dataset.kind);
    $('pRotL').onclick = () => rotate(-1);
    $('pRotR').onclick = () => rotate(1);
    $('pPlace').onclick = place;
    $('pReady').onclick = () => {
      st.ready = !st.ready;
      st.readyAt = Date.now();
      st.net.send({ t: 'ready', on: st.ready });
      renderReady();
    };
  }

  function start(code) {
    st.code = code;
    st.cid = getCid();
    $('pCode').textContent = code;
    bindUI();
    bindCanvas();
    connect();
    requestAnimationFrame(loop);
    root.PLB = { st, draw };   // 테스트·디버깅용
  }

  root.Player = { start };
})(typeof self !== 'undefined' ? self : this);
