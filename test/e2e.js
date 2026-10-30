// 종단 테스트: 호스트 1 + 폰 N (기본 30명)
//   node test/e2e.js                 가짜 PeerJS(BroadcastChannel), 한 브라우저 컨텍스트
//   node test/e2e.js --real          진짜 PeerJS 클라우드 서버 + WebRTC, 폰마다 별도 컨텍스트(실제 폰처럼 저장소 분리)
//   node test/e2e.js --real --url https://아이디.github.io/저장소/   배포된 사이트로
//   옵션: --phones 30  --obs 2  --games 2  --course long|short  --labels "커피*1,꽝*29"
// 이름 → 출발 위치(한 곳에 몰기 포함) → 장애물(거절 사유 포함) → 준비 → 31번째 입장 거절 → 시작 → 전원 결과 → 다시 하기
const fs = require('fs');
const path = require('path');
const { serve } = require('./server');
const { launch, routeCdn, watch } = require('./browser');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const REAL = argv.includes('--real');
const URL_ARG = opt('url', null);
const N = +opt('phones', 30);
const OBS = +opt('obs', 2);
const GAMES = +opt('games', 2);
const COURSE = opt('course', 'long');
const OUT = path.join(__dirname, 'out', REAL ? 'real' : 'fake');
fs.mkdirSync(OUT, { recursive: true });

const NAMES = [
  '김철수', '이영희', '박민준', 'Alice', '최지우', '정하늘', 'Bob', '강다은', '윤서준', '가나다라마바사아',
  '남궁민수', 'Charlie', '장미', '한별', '서지민', 'Kim민지', '2반 대장', '신동엽', 'Jonathan', '뷁뷁뷁뷁',
  '권보아', '황인준', 'Zoe', '안유진', '아이유♥', '송가인', '팀장 Lee', '무지개', 'WWWWWWWW', '김',
];
const LABELS = opt('labels', null) || '커피 쏘기\n간식 쏘기\n설거지\n청소 당번\n발표하기\n꽝*25';

const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { mode: REAL ? 'real-peerjs' : 'fake-peerjs', course: COURSE, phones: N, obsPer: OBS, games: [], checks: [], errors: [] };
function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

(async () => {
  const server = URL_ARG ? null : await serve(0);
  const base = URL_ARG || `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  const bag = { errors: [], resource: [] };
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  // 배포된 사이트를 시험할 때는 실제 CDN을 그대로 쓴다
  const ROUTE = !(REAL && URL_ARG);
  if (ROUTE) await routeCdn(hostCtx, { fake: !REAL });
  const host = await hostCtx.newPage();
  watch(host, 'host', bag);
  await host.goto(base);
  await host.waitForSelector('#hSetup:not(.hidden)');

  // ---------- 설정 ----------
  await host.fill('#labels', LABELS);
  const cur = +(await host.textContent('#obsOut'));
  for (let i = cur; i < OBS; i++) await host.click('#obsPlus');
  for (let i = cur; i > OBS; i--) await host.click('#obsMinus');
  check('칸 이름 파싱', (await host.textContent('#labelsHint')).trim() === '30칸', await host.textContent('#labelsHint'));
  await host.click(`#coursePick [data-course="${COURSE}"]`);
  await host.screenshot({ path: path.join(OUT, '01-host-setup.png') });
  await host.click('#openRoom');
  await host.waitForFunction(() => document.querySelector('#net').classList.contains('ok'), null, { timeout: 30000 });
  const code = await host.evaluate(() => PLB.st.code);
  const joinUrl = await host.getAttribute('#joinUrl', 'title');
  check('방 열림 + 참가 주소', /^[A-Z2-9]{4}$/.test(code) && joinUrl.endsWith('?room=' + code), joinUrl);
  const qrDark = await host.evaluate(() => { const c = document.getElementById('qr'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 50) n++; return n; });
  check('QR 그려짐', qrDark > 5000, qrDark);

  // ---------- 폰 입장 ----------
  const phoneCtxs = [];
  async function openPhone(i) {
    let ctx = hostCtx;
    if (REAL) {
      ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      if (ROUTE) await routeCdn(ctx, { fake: false });
      phoneCtxs.push(ctx);
    }
    const pg = await ctx.newPage();
    if (!REAL) {
      // 같은 컨텍스트라 localStorage를 같이 쓰므로 폰마다 다른 신원을 준다 (실제 폰에서는 기기마다 다름)
      await pg.addInitScript(cid => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (k) { return this === window.localStorage && k === 'plb.cid' ? cid : get.call(this, k); };
        Storage.prototype.setItem = function (k, v) { if (this === window.localStorage && k === 'plb.cid') return; return set.call(this, k, v); };
      }, 'testphone' + i);
      await pg.setViewportSize({ width: 390, height: 844 });
    }
    watch(pg, 'phone' + i, bag);
    await pg.goto(joinUrl.startsWith('http') && (REAL || URL_ARG) ? joinUrl : base + '?room=' + code);
    return pg;
  }
  const phones = await inBatches([...Array(N).keys()], REAL ? 5 : 10, openPhone);
  log('phones opened', phones.length);

  // ---------- 이름 ----------
  await phones[0].waitForSelector('#pName:not(.hidden)', { timeout: 60000 });
  await phones[0].fill('#pNameInput', NAMES[0]);
  await phones[0].click('#pNameBtn');
  await phones[0].waitForSelector('#pLobby:not(.hidden)', { timeout: 20000 });
  // 중복 이름 거절
  await phones[1].waitForSelector('#pName:not(.hidden)', { timeout: 60000 });
  await phones[1].fill('#pNameInput', NAMES[0].toLowerCase());
  await phones[1].click('#pNameBtn');
  await phones[1].waitForFunction(() => document.getElementById('pNameErr').textContent.length > 0, null, { timeout: 15000 });
  check('중복 이름 거절', (await phones[1].textContent('#pNameErr')).includes('이미 있는 이름'), await phones[1].textContent('#pNameErr'));
  await inBatches(phones.slice(1), 10, async pg => {
    const i = phones.indexOf(pg);
    await pg.waitForSelector('#pName:not(.hidden)', { timeout: 60000 });
    await pg.fill('#pNameInput', NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''));
    await pg.click('#pNameBtn');
    await pg.waitForSelector('#pLobby:not(.hidden)', { timeout: 30000 });
  });
  await host.waitForFunction(n => PLB.st.players.filter(p => p.name).length === n, N, { timeout: 30000 });
  check(`${N}명 이름 등록`, true);
  const courses = await Promise.all(phones.map(pg => pg.evaluate(() => PLB.st.map.id)));
  check(`폰 ${N}대 모두 같은 코스(${COURSE})`, courses.every(c => c === COURSE), [...new Set(courses)]);

  // 31번째는 거절
  if (N >= 30) {
    const extra = await openPhone(99);
    await extra.waitForSelector('#pError:not(.hidden)', { timeout: 30000 });
    check('31번째 입장 거절', (await extra.textContent('#pErrMsg')).includes('꽉 찼어요'), await extra.textContent('#pErrMsg'));
    await extra.close();
  }

  // ---------- 보드 좌표 도우미 ----------
  async function tapBoard(pg, mx, my) {
    await pg.bringToFront();
    const [x, y] = await pg.evaluate(([mx, my]) => {
      PLB.draw();   // 최신 좌표 변환 (쌓인 이름 때문에 보드 범위가 바뀔 수 있음)
      const r = document.getElementById('pCanvas').getBoundingClientRect();
      return [r.left + PLB.st.T.x(mx), r.top + PLB.st.T.y(my)];
    }, [mx, my]);
    await pg.mouse.click(x, y);
  }

  // ---------- 출발 위치: 14명은 한가운데로 몰고, 나머지는 흩어 놓는다 ----------
  for (let i = 0; i < N; i++) {
    const pg = phones[i];
    if (i < 14) await tapBoard(pg, 15, 10);
    else await tapBoard(pg, 2 + ((i * 7.3) % 26), 10);
    if (i === 20) { await pg.click('#pLeft'); await pg.click('#pLeft'); }
    if (i === 21) {
      const r = await pg.evaluate(() => { const b = document.getElementById('pCanvas').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
      await pg.mouse.move(r[0] + r[2] * 0.3, r[1] + r[3] * 0.5);
      await pg.mouse.down();
      await pg.mouse.move(r[0] + r[2] * 0.6, r[1] + r[3] * 0.5, { steps: 8 });
      await pg.mouse.up();
    }
  }
  await sleep(1500);
  const layoutCheck = await host.evaluate(() => {
    const pos = Sim.layoutStart(PLB.st.players.filter(p => p.name).map(p => ({ id: p.id, x: p.x, w: p.w })));
    const tiers = Object.values(pos).map(p => p.tier);
    return { maxTier: Math.max(...tiers), topY: Math.min(...Object.values(pos).map(p => p.y)) };
  });
  check('한 곳에 몰려도 천장 아래에 쌓임 (MAX_TIER)', layoutCheck.maxTier <= 9 && layoutCheck.topY > -15, layoutCheck);
  const xMismatch = [];
  for (const pg of phones) {
    const r = await pg.evaluate(() => [PLB.st.me.id, PLB.st.myX]);
    const hx = await host.evaluate(id => PLB.st.players.find(p => p.id === id).x, r[0]);
    if (Math.abs(hx - r[1]) > 0.011) xMismatch.push([r[0], hx, r[1]]);
  }
  check('폰과 호스트의 출발 위치 일치', xMismatch.length === 0, xMismatch.slice(0, 5));
  await phones[0].bringToFront();
  await phones[0].screenshot({ path: path.join(OUT, '02-phone-lobby.png') });
  await host.bringToFront();
  await host.screenshot({ path: path.join(OUT, '03-host-lobby-stacked.png') });

  // ---------- 장애물 ----------
  async function statusOf(pg) { return pg.evaluate(() => { const s = document.getElementById('pObsStatus'); return { text: s.textContent, ok: s.classList.contains('ok'), bad: s.classList.contains('bad') }; }); }
  const mineCount = pg => pg.evaluate(() => PLB.st.obstacles.filter(o => o.owner === PLB.st.me.id).length);
  if (OBS > 0) {
    // 거절 사유: 핀 옆, 납작한 벽돌
    const p0 = phones[0];
    await p0.bringToFront();
    await p0.click('#pTabs [data-tab="obs"]');
    await tapBoard(p0, 6.3, 5.2);
    check('핀과 겹치게 설치 거절 사유', (await statusOf(p0)).text.includes('맵 구조물과 겹쳐요'), (await statusOf(p0)).text);
    await p0.click('#pKinds [data-kind="block"]');
    await tapBoard(p0, 15, 6.6);
    await p0.click('#pRotL');   // 15° → 0°
    check('납작한 벽돌 거절 사유', (await statusOf(p0)).text.includes('15° 이상'), (await statusOf(p0)).text);
    await p0.screenshot({ path: path.join(OUT, '04-phone-obstacle-reject.png') });
    await p0.click('#pRotR');

    // 사람처럼: 보드의 빨간 후광(금지 구역)을 보고 빈 곳을 골라 탭한다.
    // 빈 곳 후보는 폰이 알고 있는 장애물 기준이라, 동시에 같은 곳을 노리면 호스트가 거절할 수 있다(그것도 확인).
    const pickFree = pg => pg.evaluate(() => {
      const e = PLB.st.edit || { kind: PLB.st.kind, a: PLB.st.kind === 'block' ? Math.PI / 12 : 0 };
      const map = PLB.st.map, spots = [];
      for (let y = 4.5; y <= 28.5; y += 0.5) for (let x = 2; x <= 28; x += 0.5) {
        if (Sim.validateObstacle(map, PLB.st.obstacles, { id: '__t', kind: e.kind, x, y, a: e.a }).ok) spots.push([x, y]);
      }
      return spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
    });
    const kinds = ['block', 'tramp', 'bumper'];
    let placed = 0, attempts = 0, hostRejects = 0, noRoom = 0;
    for (let round = 0; round < OBS; round++) {
      for (let i = 0; i < N; i++) {
        const pg = phones[i];
        await pg.bringToFront();
        if (round === 0) await pg.click('#pTabs [data-tab="obs"]');
        const before = await mineCount(pg);
        if (before >= OBS) continue;
        let done = false;
        for (let t = 0; t < 6 && !done; t++) {
          const kind = kinds[(i + round + t) % 3];
          await pg.click(`#pKinds [data-kind="${kind}"]`);
          if ((i + round) % 4 === 1 && kind !== 'bumper') await pg.click('#pRotR');
          const spot = await pickFree(pg);
          if (!spot) { noRoom++; continue; }
          await tapBoard(pg, spot[0], spot[1]);
          attempts++;
          if (!(await statusOf(pg)).ok) continue;
          await pg.click('#pPlace');
          const res = await pg.waitForFunction(b => {
            const n = PLB.st.obstacles.filter(o => o.owner === PLB.st.me.id).length;
            if (n > b) return 'ok';
            const s = document.getElementById('pObsStatus');
            return !PLB.st.pending && s.classList.contains('bad') ? 'bad' : false;
          }, before, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => 'timeout');
          if (res === 'ok') { placed++; done = true; } else hostRejects++;
        }
      }
    }
    await sleep(800);
    // 한도 초과: 다 놓은 사람이 하나 더 놓으려 하면
    const full = [];
    for (const pg of phones) if ((await mineCount(pg)) >= OBS) full.push(pg);
    if (full.length) {
      const pl = full[0];
      await pl.bringToFront();
      await pl.click('#pPlace');
      const limitMsg = (await statusOf(pl)).text;
      check('장애물 개수 한도', (await mineCount(pl)) === OBS && limitMsg.includes(`${OBS}개까지`), limitMsg);
    }
    const hostObs = await host.evaluate(() => PLB.st.obstacles.length);
    const perOwner = await host.evaluate(() => { const m = {}; for (const o of PLB.st.obstacles) m[o.owner] = (m[o.owner] || 0) + 1; return Math.max(0, ...Object.values(m)); });
    const want = N * OBS;
    check('장애물 설치 (호스트와 폰 개수 일치, 1인 한도 지킴)', hostObs === placed && perOwner <= OBS,
      { placed, want, hostObs, attempts, hostRejects, noRoomForKind: noRoom, maxPerPlayer: perOwner });
    report.obstacles = { placed, want, attempts, hostRejects, noRoom };
    await phones[Math.min(3, phones.length - 1)].bringToFront();
    await phones[Math.min(3, phones.length - 1)].screenshot({ path: path.join(OUT, '05-phone-obstacles.png') });
  }

  // ---------- 복구 시나리오 (--resilience) ----------
  if (argv.includes('--resilience')) {
    const online = () => host.evaluate(() => PLB.st.players.filter(p => p.name && (p.online || p.local)).length);
    // 1. 호스트 새로고침 → 같은 방코드로 복구, 폰들이 알아서 다시 붙음
    const obsBefore = await host.evaluate(() => PLB.st.obstacles.length);
    await host.reload();
    await host.waitForFunction(() => window.PLB && document.querySelector('#net').classList.contains('ok'), null, { timeout: 30000 });
    const code2 = await host.evaluate(() => PLB.st.code);
    const t1 = Date.now();
    await host.waitForFunction(n => PLB.st.players.filter(p => p.name && p.online).length === n, N, { timeout: 60000 }).catch(() => {});
    check('호스트 새로고침 후 복구 (같은 코드, 전원 재접속, 장애물 유지)', code2 === code && (await online()) === N && (await host.evaluate(() => PLB.st.obstacles.length)) === obsBefore,
      { code2, online: await online(), seconds: (Date.now() - t1) / 1000 });
    // 2. 폰 한 대 네트워크 단절(이벤트 없이 끊김) → 하트비트로 감지하고 다시 붙음
    if (!REAL) {
      const pg = phones[1];
      await pg.evaluate(() => __fp.sever());
      await sleep(3000);
      await pg.evaluate(() => __fp.heal());
      const t2 = Date.now();
      await pg.waitForFunction(() => document.getElementById('pNet').classList.contains('bad') || document.getElementById('pNet').textContent.includes('다시'), null, { timeout: 30000 }).catch(() => {});
      await pg.waitForFunction(() => document.getElementById('pNet').classList.contains('ok'), null, { timeout: 40000 }).catch(() => {});
      await host.waitForFunction(n => PLB.st.players.filter(p => p.name && p.online).length === n, N, { timeout: 30000 }).catch(() => {});
      check('폰 네트워크 끊김 → 자동 재연결', (await online()) === N && !(await pg.evaluate(() => document.getElementById('pLobby').classList.contains('hidden'))), { seconds: (Date.now() - t2) / 1000 });
    }
    // 3. 폰 새로고침 → 같은 자리(이름 유지)로 복귀
    const p2 = phones[2], id2 = await p2.evaluate(() => PLB.st.me.id);
    await p2.reload();
    await p2.waitForSelector('#pLobby:not(.hidden)', { timeout: 30000 });
    check('폰 새로고침 → 같은 자리로 복귀', (await p2.evaluate(() => PLB.st.me.id)) === id2 && (await p2.textContent('#pMeName')) === NAMES[2]);
    // 4. 강퇴 (마지막 폰) → 자리가 하나 빈다
    await host.bringToFront();
    await sleep(400);   // 백그라운드였던 호스트 탭이 목록을 다시 그릴 때까지
    const victim = phones[N - 1], victimName = await victim.textContent('#pMeName');
    await host.evaluate(name => {
      const li = [...document.querySelectorAll('#plist li')].find(l => l.querySelector('.pname') && l.querySelector('.pname').textContent === name);
      li.querySelector('.x').click();
    }, victimName);
    await victim.waitForSelector('#pError:not(.hidden)', { timeout: 15000 });
    check('강퇴된 폰에 안내', (await victim.textContent('#pErrMsg')).includes('내보냈어요'));
    phones.pop();
    await sleep(400);
    // 5. 폰 없는 사람 추가 + 보드에서 끌기 (이 사람은 다음 게임에 그대로 참가)
    //    14명이 몰린 가운데에 둬서, 쌓을 자리가 꽉 차 옆으로 비켜 그려진 이름도 끌리는지 본다.
    //    끌기는 그려진 자리 기준이라 놓은 곳 = 그려진 x + 끈 거리 (고른 x와는 다를 수 있음)
    await host.fill('#addName', '폰없음');
    await host.click('#addForm button');
    await sleep(500);
    await host.evaluate(() => { PLB.st.players.find(p => p.local).x = 15; });
    await sleep(1000);   // 카메라가 새 배치에 맞춰 멈출 때까지
    const drag = await host.evaluate(() => {
      const p = PLB.st.players.find(q => q.local);
      const pos = Sim.layoutStart(PLB.st.players.filter(q => q.name).map(q => ({ id: q.id, x: q.x, w: q.w })))[p.id];
      const r = document.getElementById('board').getBoundingClientRect();
      return { px: r.left + PLB.st.T.x(pos.x), py: r.top + PLB.st.T.y(pos.y), k: PLB.st.T.k, chosenX: p.x, shownX: pos.x };
    });
    await host.mouse.move(drag.px, drag.py);
    await host.mouse.down();
    const dir = drag.shownX < 15 ? 1 : -1;   // 벽 쪽으로 끌면 막히므로 가운데 쪽으로
    await host.mouse.move(drag.px + dir * 4 * drag.k, drag.py, { steps: 6 });
    await host.mouse.up();
    const localX1 = await host.evaluate(() => PLB.st.players.find(p => p.local).x);
    check('폰 없는 사람 추가 + 보드에서 끌어 위치 변경 (옆으로 비켜 그려진 이름)', Math.abs(localX1 - (drag.shownX + dir * 4)) < 0.5,
      { chosenX: drag.chosenX, shownX: +drag.shownX.toFixed(2), localX1 });
  }
  const NP = phones.length;
  const NALL = await host.evaluate(() => PLB.st.players.filter(p => p.name).length);   // 폰 없는 사람 포함
  const obsAtStart = await host.evaluate(() => PLB.st.obstacles.length);

  // 대기실 메시지 크기 (PeerJS json 한도 16300B)
  const lobbyBytes = await host.evaluate(() => Net.sizeOf(PLB.lobbyMsg()));
  check('대기실 메시지 < 16KB', lobbyBytes < 16000, lobbyBytes + 'B');
  report.lobbyBytes = lobbyBytes;

  // ---------- 게임 ----------
  for (let gi = 0; gi < GAMES; gi++) {
    await inBatches(phones, 10, async pg => {
      if (!(await pg.evaluate(() => PLB.st.ready))) await pg.click('#pReady');
    });
    await host.waitForFunction(n => PLB.st.players.filter(p => p.name && p.ready).length === n, NALL, { timeout: 30000 });
    // 패널은 다음 프레임에 다시 그려지므로 화면 숫자가 따라올 때까지 기다린다
    await host.waitForFunction(n => document.getElementById('cPlayers').textContent === String(n) && document.getElementById('cReady').textContent === String(n), NALL, { timeout: 5000 }).catch(() => {});
    const counts = await host.evaluate(() => [document.getElementById('cPlayers').textContent, document.getElementById('cReady').textContent]);
    check(`[${gi + 1}판] 전원 준비 표시`, counts[0] === String(NALL) && counts[1] === String(NALL), counts);
    await host.bringToFront();
    await host.screenshot({ path: path.join(OUT, `06-host-lobby-ready-${gi + 1}.png`) });
    const wall0 = Date.now();
    await host.click('#startBtn');
    await inBatches(phones, 10, pg => pg.waitForSelector('#pRun:not(.hidden)', { timeout: 20000 }));
    check(`[${gi + 1}판] 폰 전원 진행 화면`, true);
    await host.waitForFunction(() => PLB.st.phase === 'running', null, { timeout: 20000 });
    await sleep(5000);
    const race = await Promise.all(phones.map(pg => pg.evaluate(() => ({
      shown: !document.getElementById('pRace').classList.contains('hidden'),
      rank: document.getElementById('pRunRank').textContent, done: !document.getElementById('pDone').classList.contains('hidden'),
    }))));
    const racing = race.filter(r => !r.done);
    check(`[${gi + 1}판] 폰에 실시간 순위 표시`, racing.length > 0 && racing.every(r => r.shown && /^\d+등$/.test(r.rank)), { racing: racing.length, sample: racing.slice(0, 3) });
    const live = await host.evaluate(() => ({ shown: !document.getElementById('liveWrap').classList.contains('hidden'), rows: document.querySelectorAll('#liveRank li').length }));
    check(`[${gi + 1}판] 호스트 실시간 순위`, live.shown && live.rows > 0, live);
    const racer = phones[race.findIndex(r => !r.done && r.shown)];
    if (racer) { await racer.bringToFront(); await racer.screenshot({ path: path.join(OUT, `07b-phone-race-${gi + 1}.png`) }); await host.bringToFront(); }
    await host.screenshot({ path: path.join(OUT, `07-host-running-${gi + 1}.png`) });
    await host.waitForFunction(() => PLB.st.phase === 'done', null, { timeout: 240000, polling: 500 });
    const wall = (Date.now() - wall0) / 1000;
    await sleep(1800);
    await host.screenshot({ path: path.join(OUT, `08-host-results-${gi + 1}.png`) });
    const g = await host.evaluate(() => ({
      t: PLB.st.game.t, seed: PLB.st.seed, results: PLB.st.results.map(r => ({ id: r.id, label: r.label, seg: r.seg })),
      stats: PLB.st.stats, sudden: PLB.st.game.suddenDone, final: PLB.st.game.finalDone,
    }));
    const segs = new Set(g.results.map(r => r.seg));
    check(`[${gi + 1}판] ${NALL}명 전원 결과, 칸 중복 없음`, g.results.length === NALL && segs.size === NALL, { results: g.results.length, unique: segs.size });
    // 폰마다 받은 결과가 호스트와 같은지
    const phoneRes = await Promise.all(phones.map(pg => pg.evaluate(() => ({ id: PLB.st.me.id, label: PLB.st.result && PLB.st.result.label, shown: !document.getElementById('pDone').classList.contains('hidden'), text: document.getElementById('pLabel').textContent }))));
    const wrong = phoneRes.filter(p => { const r = g.results.find(x => x.id === p.id); return !r || !p.shown || p.text !== r.label; });
    check(`[${gi + 1}판] 폰 ${NP}대 모두 내 결과 표시`, wrong.length === 0, wrong.slice(0, 5));
    const fps = g.stats.frames / Math.max(1, wall);
    report.games.push({ gameSeconds: +g.t.toFixed(1), wallSeconds: +wall.toFixed(1), seed: g.seed, sudden: g.sudden, final: g.final, hostFps: +fps.toFixed(1), avgStepMs: +(g.stats.stepMs / Math.max(1, g.stats.steps)).toFixed(3), slowFrames: g.stats.slowFrames });
    log('game', gi + 1, JSON.stringify(report.games[report.games.length - 1]));
    await phones[Math.min(5, phones.length - 1)].bringToFront();
    await phones[Math.min(5, phones.length - 1)].screenshot({ path: path.join(OUT, `09-phone-result-${gi + 1}.png`) });
    await host.bringToFront();
    await host.evaluate(() => { PLB.st.stats = { frames: 0, slowFrames: 0, maxSteps: 0, stepMs: 0, steps: 0 }; });
    if (gi < GAMES - 1) {
      await host.click('#againBtn');
      await inBatches(phones, 10, pg => pg.waitForSelector('#pLobby:not(.hidden)', { timeout: 20000 }));
      const readyAfter = await Promise.all(phones.map(pg => pg.evaluate(() => PLB.st.ready)));
      check('다시 하기: 폰 대기실 복귀 + 준비 초기화', readyAfter.every(r => !r));
      const keptObs = await host.evaluate(() => PLB.st.obstacles.length);
      check('다시 하기: 장애물 유지', keptObs === obsAtStart, { keptObs, obsAtStart });
    }
  }

  if (!REAL) report.fakePeer = await host.evaluate(() => window.__fpStats);
  report.errors = bag.errors;
  report.resourceErrors = bag.resource.length;
  report.peerServerErrors = bag.network || [];
  if (report.peerServerErrors.length) log('PeerJS 서버 일시 오류 (앱이 다시 연결함)', report.peerServerErrors.length, JSON.stringify(report.peerServerErrors.slice(0, 3)));
  check('콘솔 에러 없음', bag.errors.length === 0, bag.errors.slice(0, 8));
  report.ok = report.checks.every(c => c.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log(report.ok ? 'ALL PASS' : 'SOME CHECKS FAILED', '→', path.join(OUT, 'report.json'));
  await browser.close();
  if (server) server.close();
  process.exit(report.ok ? 0 : 1);
})().catch(async e => {
  console.error(e);
  process.exit(1);
});
