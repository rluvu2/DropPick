# 핀볼 사다리 (Pinball Ladder) — Claude Code 작업 가이드

마블룰렛(lazygyu/roulette)을 모티브로 한 **핀볼형 사다리타기** 웹 게임.
PC(큰 화면)가 방을 열면 참가자가 폰으로 QR을 찍어 들어와 **출발 위치**와 **장애물**을 정한다.
그다음 **이름 글자 모양 그대로의 물리 바디**가 떨어지고, 바닥의 **레이저 결승선 칸**을 통과하면 그 칸이 결과로 확정된다.

- 사용자와는 **한국어**로 대화한다. UI 문구도 전부 한국어.
- 배포: **GitHub Pages(github.io)**. 빌드 없이 정적 파일 그대로 올린다.
- 상표 주의: "마블 룰렛 / Marble Roulette"는 lazygyu의 상표다. 이 이름이나 비슷한 이름을 쓰지 않는다. 코드는 참고만 한다(MIT).

---

## 확정된 요구사항 (사용자 결정 사항 — 바꾸지 말 것)

1. **초기 설정은 PC에서**: 바닥 칸 이름 목록, 1인당 장애물 개수.
2. **아이템·스킬 없음**: 파워업, 버섯, 폰 스킬 버튼 같은 건 넣지 않는다. 맵 자체 기믹(풍차·범퍼·핀)은 괜찮다.
3. **통신은 PeerJS**(무료 공용 클라우드 서버 `0.peerjs.com`). 별도 서버, Firebase 같은 계정 설정 없이 동작해야 한다.
4. **바닥 = 레이저 결승선**: 결승선(y = FINISH_Y)을 칸 수만큼 나눈다. 이름이 어떤 칸을 통과하면 그 칸이 확정된다. 확정된 칸은 양쪽 경계선이 하나로 합쳐지면서 사라지고(폭 0으로 줄어듦), 이웃 칸들이 그 자리를 메운다.
   - 남은 칸이 항상 바닥 전체를 덮으므로 **한 칸에 두 명이 들어갈 수 없고, 판이 반드시 끝난다.**
5. 참가자는 **본인 공(이름)의 출발 x 위치**를 폰에서 정한다. 같은 위치를 고르면 위로 쌓인다(`layoutStart`).
6. 참가자는 **장애물을 설치**할 수 있다. 길막을 막기 위해 다음 장치를 둔다.
   - 벽돌은 3번 맞으면 부서진다. 트램펄린과 범퍼는 3번 쓰면 사라진다.
   - 설치 금지 구역과 최소 간격을 강제한다.
   - 45초 서든데스에 전부 파괴된다.
7. 이름은 **글자 외곽선 모양 그대로** 물리 바디가 된다(공 모양 아님).

---

## 현재 상태

### 완료 ✅ (2026-10-29, 전 모듈 구현 + 30명 검증)
- `src/sim.js` — 물리 코어. UMD라서 브라우저(`window.Sim`, `window.planck` 필요)와 Node(`require`) 양쪽에서 돈다. DOM 의존 없음.
  - 고친 것: `confirm` 이벤트의 `t`가 결과 객체의 시간 값으로 덮여 화면이 확정을 못 받던 버그.
  - 고친 것: 30명이 한 자리에 몰리면 천장(y=-16) 위까지 쌓이던 문제 → `MAX_TIER`(9단)를 넘으면 가장 가까운 빈자리로 옆으로 비킨다.
- `src/glyph.js`, `src/render.js`, `src/net.js`, `src/host.js`, `src/player.js`, `src/app.js`, `index.html` — 아래 설계대로 구현.
- `src/style.css` — 호스트·폰 UI 스타일 (디자인 토큰 포함).
- 테스트: `test/headless.js`(물리), `test/stress.js`(병렬 대량), `test/e2e.js`(호스트 1 + 폰 30), `test/fakepeer.js`, `test/export-glyphs.js` → `test/fixtures/names.json`(실제 글자 모양 50개), `test/browser-batch.js`(브라우저 안에서 대량), `test/host-perf.js`(호스트 fps), `test/server.js`, `test/browser.js`.
- 배포: GitHub Pages `https://rluvu2.github.io/DropPick/` (main / root).

### 30명 검증에서 알게 된 것 (중요)
- **PeerJS json 직렬화는 16300바이트 이상 메시지를 조용히 버린다.** 객체 형식 lobby 메시지는 30명 × 장애물 5개에서 17KB를 넘는다 → 배열로 압축(아래 프로토콜). 30명 실측 2.6KB. `net.js`가 16000바이트 이상은 보내지 않고 콘솔 에러를 낸다. `fakepeer.js`도 같은 한도를 흉내 낸다.
- **이름을 매 프레임 회전된 텍스트로 그리면 30명에서 프레임당 100ms를 넘는다**(GPU 없는 환경). 이름마다 비트맵 스프라이트를 만들어 `drawImage`로 돌려 그린다(`render.js nameSprite`, 확대 배율이 바뀌면 프레임당 6개씩만 다시 만듦). 레이저 글로우도 `shadowBlur` 대신 넓은 반투명 선. → 헤드리스(소프트웨어 렌더링)에서도 30명 60fps.
- 물리 비용: 실제 글자 모양 30명 ≈ 스텝당 0.5~2ms (예산 8.3ms). 다른 무거운 작업과 CPU를 나눠 쓰면 크게 느려지므로 성능 측정은 단독으로 돌린다.
- **장애물 자리**: 설치 간격 규칙(맵 1.4m, 장애물끼리 1.5m) 때문에 보드에는 약 25~30개가 한계다. 30명 × 2개면 절반쯤만 놓인다. 빈자리가 없으면 폰에 "빈자리가 없어요"가 뜬다.
- 호스트 탭이 백그라운드가 되면 rAF가 멈춰 게임이 멈춘다. 테스트에서는 `bringToFront()`로 호스트 탭을 앞에 둔다.
- 도구 주의: 파일을 쓸 때 정규식에 `​` 같은 이스케이프를 쓰면 실제 보이지 않는 문자로 바뀌어 문법 오류가 난 적이 있다. 문자 범위는 `codePointAt` 비교로 쓴다.

---

## 파일 구조

```
index.html          역할 분기: ?room=XXXX 있으면 폰(참가자), 없으면 PC(호스트). 화면은 <template>
src/sim.js          물리 코어
src/style.css       스타일
src/glyph.js        글자 → 다각형
src/render.js       캔버스 렌더링(이름 스프라이트) + 이펙트 + 사운드(WebAudio) + 토스트
src/net.js          PeerJS 래퍼 (16000바이트 가드, 하트비트, 재연결)
src/host.js         호스트 앱 (window.PLB = 테스트용 상태 노출)
src/player.js       참가자 앱
src/app.js          부트스트랩 (CDN이 막히면 안내 화면)
test/headless.js    물리 검증          test/stress.js      병렬 대량 검증
test/e2e.js         Playwright 종단    test/fakepeer.js    테스트용 가짜 Peer
test/export-glyphs.js + test/fixtures/names.json   실제 글자 모양
test/browser-batch.js  test/host-perf.js  test/server.js  test/browser.js
.nojekyll
```

CDN (index.html, **버전 고정**):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=IBM+Plex+Sans+KR:wght@400;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/planck@1.4.2/dist/planck.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js"></script>
<script src="src/sim.js"></script> ... (glyph, render, net, host, player, app 순)
```
- planck 1.5.x는 2026-10 출시라 아직 쓰지 않는다. 1.4.2로 검증했다.
- PeerJS는 `window.Peer`, qrcode-generator는 전역 `qrcode`를 노출한다.

---

## 아키텍처 원칙 (반드시 지킬 것)

- **물리는 호스트(PC)에서만** 돈다. 폰은 입력만 보내는 컨트롤러다. 폰에는 위치를 스트리밍하지 않는다.
- **호스트가 유일한 심판**이다. 이름·출발 위치·장애물은 전부 호스트가 다시 검증한다. 폰의 사전 검증은 즉각적인 피드백용일 뿐이다.
- **고정 타임스텝** `C.DT = 1/120`. rAF 누산기로 돌리고, 프레임당 최대 16스텝(넘치면 누산기를 버림).
- **모든 랜덤은 시드 기반**(`Sim.makeRng`). 디버깅·재현용.
- **월드 변경(바디 생성·삭제)은 스텝 사이에서만** 한다. 충돌 콜백 안에서는 기록만 한다(`hits` 배열 → `_processHits`).
- 단위: **1 = 1m, y는 아래로 증가**(화면 좌표와 같은 방향). 그릴 때만 px로 변환한다.
- 시뮬레이션 코어는 DOM에 의존하지 않는다. `sim.js`를 수정한 뒤에는 **반드시 `npm test`(헤드리스 200판)로 미종료 0, 중복 0을 확인**한다.
- `localStorage`/`sessionStorage`는 항상 try/catch로 감싼다.

---

## sim.js API 요약 (이미 구현됨)

```js
Sim.C            // 상수 (W=30, FINISH_Y=31, VIEW, ZONE, NAME_*, T_SUDDEN=45, T_FINAL=75, MAX_PLAYERS=30, MAX_SEGMENTS=30 …)
Sim.OBS          // { block:{label:'벽돌',len,th,hp:3}, tramp:{label:'트램펄린',len,th,hp:3}, bumper:{label:'범퍼',r,hp:3} }
Sim.buildMap()   // { W, F, els:[{kind:'wall'|'deflector'|'pin'|'bumper'|'mill', ...}] } — 호스트·폰이 같은 코드로 같은 맵 생성
Sim.validateObstacle(map, list, o) // → {ok} | {ok:false, reason:'한국어 사유'} (list 안의 같은 id는 무시)
Sim.normAngle(kind, a)   // 상자 180° 대칭, 트램펄린은 윗면이 위를 향하게
Sim.obsGeom(o)
Sim.layoutStart([{id,x,w}]) // → {id:{x,y,tier}} 같은 자리면 TIER_DY만큼 위로 쌓음 (배열 순서 = 우선순위)
                            //   MAX_TIER(9)를 넘으면 가장 가까운 빈자리로 옆으로 비킨다 (천장 y=-16 아래 유지)
Sim.clampDropX(x, w)
Sim.cleanPoly(points, maxV) // 볼록 껍질 + 꼭짓점 ≤ maxV, 너무 작으면 null
Sim.makeRng(seed)
Sim.Segments     // 레이저 칸: list[{i,label,w,target,owner,closed}], bounds(), assign(x, owner, t), update(dt), openCount()
new Sim.Game({ seed, map, labels:[], names:[{id, polys, w, h, x}], obstacles:[{id, owner, kind, x, y, a}] })
  game.step()          // 1/120초 진행
  game.drainEvents()   // [{t:'confirm', id, seg, label, x, time} | {t:'hit'|'break'|'bounce'|'kick', id?, x, y}
                       //  | {t:'unstick', id, level} | {t:'sudden'} | {t:'final'} | {t:'end'}]
  game.over, game.t, game.names(Map: id → {body, done, ...}), game.obs(Map: id → {kind,x,y,a,hp,alive,flash}),
  game.mills[{el, body}], game.segments, game.results[{id, seg, label, x, t}]
```

물리 안전장치 (sim.js 안에 이미 있음):
- **끼임 감지**: 2초 동안 0.4m 미만으로 움직이면 단계적으로 대응한다.
  1. 튕기기
  2. 유저 장애물 통과 + 튕기기
  3. 빈 곳으로 순간이동 + 2초 유령
  4. (5단계) 영구 유령
- **순환 함정**: 7초 동안 더 내려가지 못하면 잠깐 유령 상태로 빠져나간다(`_unstall`).
- **45초 서든데스**: 유저 장애물 전부 파괴 + 중력 1.6배.
- **75초 최종 보험**: 남은 이름은 모든 충돌을 무시하고 낙하한다.
- 트램펄린은 `pre-solve`에서 아래에서 올라오는 이름을 통과시킨다(일방통행). 위에서 닿으면 윗면 방향으로 12.5m/s 발사.
- 벽돌 1타 판정은 접근 속도 ≥ 1.4m/s, 같은 이름은 0.45초 쿨다운.
- 같은 스텝에 여러 명이 결승선을 넘으면 선을 넘은 시점(보간 t) 순서로 처리한다.
- 이미 확정돼 줄어드는 중인 칸을 통과하면 가장 가까운 열린 칸으로 배정한다.

---

## 남은 모듈 상세 설계

### 1. glyph.js — 이름 → 물리 모양
- 추출 해상도 `S = 72 px/m`.
- 폰트 스택: `"Black Han Sans", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  - **굵기를 지정하지 말 것.** BHS는 400만 있어서 굵기를 지정하면 가짜 볼드가 생긴다.
- `metrics(text)` → `{fontM, w, h}`: 기본 글자 높이 `C.NAME_FONT`(1m). 폭이 `NAME_MAX_W`(4.6m)를 넘으면 `NAME_MIN_FONT`까지 축소한다. 대기실 배치 폭 `w`는 **measureText 폭**을 쓴다. 게임 시작 때도 같은 `w`를 `layoutStart`에 넘겨서 쌓임 결과가 대기실과 같게 한다.
- `loadFont(text)`: `document.fonts.load('72px "Black Han Sans"', text)`를 3초 타임아웃으로 기다린다. 한글 웹폰트는 글자 범위별로 쪼개져 있어서 **text를 꼭 넘겨야 한다.** 게임 시작 전에 호출한다.
- `trace(text)` 순서:
  1. 캔버스에 `textAlign='left'`, `textBaseline='middle'`으로 `fillText`와 `strokeText(lineWidth 2)`를 같이 그린다(살짝 부풀리기).
  2. 알파 > 110인 픽셀을 이진화한다.
  3. 8방향 연결로 덩어리를 찾는다. 덩어리는 자모나 글자 조각이다.
  4. 덩어리마다 각 행의 양 끝 픽셀 모서리 점을 모아 볼록 껍질을 만들고 `Sim.cleanPoly(pts, 8)`로 정리한다.
  5. 작은 조각을 처리한다. 0.004m² 미만은 버리고, 0.025m² 미만은 가장 가까운 덩어리와 합친다.
  6. 조각이 24개를 넘으면 글자 단위로 묶어서 볼록 껍질을 만든다(글자별 x범위는 prefix measureText로 구함).
  7. 좌표는 **글자 픽셀 bbox 중심 기준 미터** 단위다. 이 중심이 바디 원점이 된다.
  8. 반환값: `{text, fontM, ox, oy, w, h, polys}`. `(ox, oy)`는 그릴 때 fillText 위치(원점 기준, m).
  9. 다각형이 하나도 없으면 박스로 대체한다. 결과는 캐시한다.
- 그리기 규칙: `translate(바디 위치) → rotate(각도) → font = fontM*k px → fillText(text, ox*k, oy*k)` (left / middle). 글자 테두리는 진한 잉크색으로 stroke한다.

### 2. render.js — 보드 렌더링 (호스트·폰 공용)
- `setupCanvas(cv)`: DPR 처리, 최대 2배.
- `makeT(w, h, view, pad)` → `{k, x(m), y(m), mx(px), my(px)}`.
- `drawScene(ctx, T, scene)`, 그리는 순서:
  1. 배경: 바깥 `inkDeep`, 플레이필드 `ink`, 1.5m 점 격자.
  2. 설치 구역: `ZONE.y0~y1`, 좌우 `CLEAR_WALL`. 점선 앰버 테두리 + 아주 옅은 채움 + "장애물 설치 구역" 라벨. 대기실에서만 표시.
  3. 출발선: 점선. 대기실과 카운트다운에서만 표시.
  4. 맵 요소
     - 벽과 경사판: 크롬색 둥근 끝 선.
     - 핀: 크롬 원 + 하이라이트.
     - 맵 범퍼: 마젠타 링(튕길 때 확대).
     - 풍차: 크롬 십자 + 앰버 허브. 대기실에서는 회전 반경을 옅은 원으로 표시.
  5. 유저 장애물: 테두리는 **설치한 사람의 색**으로 그린다.
     - 벽돌(#E86A5B): hp가 줄 때마다 금이 하나씩 생긴다.
     - 트램펄린(teal): 아래쪽에 스프링 지그재그, 남은 횟수 점 3개.
     - 범퍼(#E46BC4): 남은 횟수 점.
     - flash 값만큼 밝게 그린다.
     - 폰 편집용 고스트: 반투명. 설치 가능하면 초록 테두리, 불가능하면 빨간 테두리.
  6. **레이저 결승선** (이 게임의 상징 요소)
     - y = FINISH_Y 아래 `LABEL_BAND` 영역을 진한 띠로 깐다.
     - 칸마다 레이저 선(#FF3B5C, shadowBlur 글로우)을 그리고, 경계에는 크롬 칸막이를 세운다.
     - 라벨은 칸 폭에 맞게 0.85m부터 0.34m까지 축소하고 클립한다.
     - 확정된 칸은 앰버→흰색으로 번쩍이며 줄어들고, 라벨은 주인 색으로 바뀐다.
     - 블라인드 모드에서는 열린 칸 라벨을 "?"로 표시한다.
  7. 이름: 각자 색으로 채우고 진한 테두리. 유령 상태면 alpha 0.45. 폰에서는 "나"를 앰버로 글로우.
  8. 이펙트
     - ring: 범퍼·트램펄린
     - shard: 벽돌 파괴 파편
     - laser flash: 통과 지점
     - float: 확정된 라벨이 결승선에서 떠오르며 사라짐
- 이름 색 팔레트(레이저 빨강은 피함): `#FFB547 #4FD1C5 #FF7AA8 #8FB8FF #B9F27C #FF8A5B #C79BFF #FFE066 #5EE0FF #FF9EE5 #7DE38D #FFC4A3 #A0E7E5 #F28BFF #9EC1FF #FFD1F0`
- 사운드(WebAudio, 아주 단순하게, 이벤트별 40ms 레이트리밋): 범퍼 "붑", 벽돌 "딱", 파괴(노이즈), 트램펄린(상승음), 확정 "띵", 카운트다운 틱. "시작" 클릭 때 AudioContext를 unlock한다. 음소거 토글.

### 3. net.js — PeerJS
- 호스트 Peer ID: `'pinball-ladder-v1-' + 방코드`. 방코드는 4자리로, 헷갈리는 문자를 뺀 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`에서 뽑는다.
- `new Peer(id, {debug:1})`. **config를 넘기지 말 것.** 넘기면 PeerJS 기본 STUN/TURN(`eu-0/us-0.turn.peerjs.com`) 설정이 사라진다.
- 데이터 연결: `peer.connect(hostId, {serialization:'json', reliable:true})`.
- 호스트 에러 처리
  - `unavailable-id`: 2.5초 뒤 같은 코드로 2번 재시도한다(새로고침 직후 이전 ID가 남아 있을 수 있음). 그래도 안 되면 새 코드를 만든다.
  - `network` / `server-error` / `socket-*`: 상태를 표시하고 백오프로 재연결한다.
  - `disconnected`: `peer.reconnect()`. 기존 데이터 연결은 유지된다.
- 참가자 쪽
  - `new Peer()` → open되면 connect. 9초 안에 open되지 않으면 재시도.
  - `peer-unavailable`이면 "방을 찾을 수 없어요" 안내.
- 하트비트: 양쪽 모두 4초마다 `{t:'hb'}`를 보낸다.
  - 호스트는 14초 동안 응답이 없으면 offline으로 표시한다.
  - 폰은 12초 동안 응답이 없으면 재연결한다. `visibilitychange`로 화면이 다시 보일 때도 연결을 확인한다.
- 폰 신원: `localStorage 'plb.cid'`(랜덤 영숫자). 새로고침하면 같은 자리로 복귀한다.

### 메시지 프로토콜

호스트 → 폰
```
{t:'welcome', id, name|null, color, x, ready, phase('lobby'|'running'|'done'), obsPer, result|null, code, inGame}
{t:'name-ok', name, color} | {t:'name-bad', reason}
{t:'lobby', players:[[id, name, color, x, w, fontM, flags, nObs]], obsPer, obstacles?:[[id, kind, x, y, a]], labels?:[...]}
  - flags: 1 준비, 2 온라인, 4 폰 없음. x는 각자 고른 출발 x(호스트가 clamp). 쌓인 위치(y, 옆으로 비킨 x)는
    폰이 같은 순서로 Sim.layoutStart를 돌려 직접 계산한다.
  - obstacles·labels는 바뀌었을 때만 넣는다(연결마다 obsRev·labRev 기억). 장애물 소유자는 id 앞부분('p3:o1' → 'p3').
  - labels는 블라인드면 전부 '?'. 숫자는 x·y 0.01, 각도 0.001로 반올림(검증한 값 그대로 보냄).
  - 배열인 이유: PeerJS json 채널의 16300바이트 한도 (위 "30명 검증" 참고).
{t:'obs-ok', id, op} | {t:'obs-bad', id, reason}     (id는 폰의 로컬 id)
{t:'start'}  {t:'mine', label, seg, order}  {t:'end', results:[{name,color,label}]}
{t:'lobby-again'}  {t:'kicked'}  {t:'full'}  {t:'hb'}
```
폰 → 호스트
```
{t:'hello', cid}  {t:'name', name}  {t:'drop', x}
{t:'obs', op:'put', id, kind, x, y, a}  {t:'obs', op:'del', id}
{t:'ready', on}  {t:'hb'}
```

호스트 검증 규칙
- 이름: 공백을 정리하고 1~8글자(코드포인트 기준). 중복(대소문자 무시)이면 "이미 있는 이름이에요".
- 처음 이름을 정하면 출발 x는 랜덤으로 준다(모두 가운데에 쌓이는 것 방지).
- 장애물
  - 대기실 단계에서만 받는다.
  - 저장 id는 `플레이어id:로컬id`로 만들어 소유권을 보장한다.
  - 개수가 `obsPer`를 넘으면 거절한다.
  - `normAngle`로 각도를 정리한 뒤 `validateObstacle`로 검사한다.
- 진행 중에 새로 들어온 사람은 이름만 받아두고 다음 판부터 참여시킨다.
- 최대 30명. 넘으면 `full`을 보낸다.
- 설정에서 `obsPer`를 줄이면 초과분은 최근 것부터 삭제한다.
- 로비 브로드캐스트는 초당 최대 5회로 스로틀한다.

### 4. host.js — PC
단계: `setup → lobby → countdown(3초) → running → done`

- **setup**
  - 칸 이름 textarea: 줄바꿈이나 쉼표로 구분. `꽝*3` 또는 `꽝×3` → 3칸. 최대 30칸, 라벨은 12자까지.
  - 1인당 장애물 수: 스테퍼 0~5, 기본 2.
  - "칸 이름 가리기" 체크박스: 시작할 때 섞고, 통과한 칸만 공개.
  - "방 열기" 버튼. 설정은 `localStorage 'plb.setup'`에 저장한다.
  - 입력하는 동안 보드의 결승선 칸 미리보기가 실시간으로 바뀐다.
  - 폰으로 루트 주소에 들어온 사람을 위한 "폰으로 참가하기(코드 입력)" 접이식 메뉴.
- **lobby**
  - QR(`qrcode(0,'M')`, 150px 캔버스)과 방코드를 크게 표시한다. 참가 URL은 `origin + pathname + '?room=' + code`.
    - `file:`이나 localhost에서 열었으면 "폰에서 접속하려면 GitHub Pages 주소로 열어주세요"라고 안내한다.
  - 참가자 목록: 색, 이름, 준비 상태, 장애물 수, 강퇴 버튼.
  - "폰 없는 사람" 추가 입력: local 플레이어로 항상 준비 상태. 보드에서 그 이름을 드래그해 출발 위치를 바꿀 수 있다.
  - 시작 조건: 참가자 1명 이상, 참가자 수 ≤ 칸 수(부족하면 "칸이 n개 부족해요").
    - 준비 안 된 사람이 있으면 버튼이 3초 동안 "그래도 시작"으로 바뀐다. confirm() 같은 브라우저 대화상자는 쓰지 않는다.
  - "설정 바꾸기"를 누르면 방은 유지한 채 setup 화면으로 가고, 버튼은 "적용"이 된다.
  - 방 상태(코드, 플레이어, 장애물, 설정)는 `sessionStorage`에 저장해서 호스트가 새로고침해도 같은 코드로 복구되게 한다.
- **countdown**
  - `Glyph.loadFont` → 각 이름 `trace`.
  - `new Sim.Game`(시드는 crypto 랜덤, 블라인드면 라벨을 섞음).
  - 3, 2, 1 숫자를 보드에 크게 표시하고 폰에는 `start`를 보낸다.
- **running**
  - 패널: 경과 시간, "남은 이름 n / 남은 칸 m", 확정 순서대로 결과 목록, 카메라 토글(따라가기/전체), 소리 토글, "중단하고 대기실로".
  - 이벤트 처리
    - `confirm`: 결과 목록 추가, 이펙트, 해당 폰에 `mine` 전송.
    - `sudden`: 배너 "서든데스! 유저 장애물이 모두 부서졌어요".
    - `final`: 배너 "마무리: 남은 이름은 모든 걸 통과해요".
  - 슬로모션: 남은 이름 ≤ 2, 열린 칸 ≥ 2, 결승선 2.5m 위에 이름이 있으면 0.4배속.
  - 자동 카메라: 남은 이름 bbox + 3m 여백, 최소 높이 16m, 스테이지 비율에 맞추고 전체 영역 안으로 제한, 지수 스무딩.
- **done**
  - 1.4초 뒤 결과 오버레이: 이름 → 칸 2열, 배정되지 않은 칸.
  - 버튼: "같은 사람들로 다시 하기"(대기실로 돌아가 준비만 초기화, 위치·장애물 유지), "결과 복사"(클립보드 텍스트), "처음부터".
  - 폰에는 `end`를 브로드캐스트한다.

### 5. player.js — 폰
섹션: `pConnecting / pError / pName / pLobby / pRun / pDone`. `.hidden` 클래스로 토글한다.

- 상단 헤더: 방코드, 연결 상태, 내 이름 칩(내 색).
- **pLobby** 탭: "출발 위치" / "장애물 (n/obsPer)". obsPer가 0이면 장애물 탭을 숨긴다.
  - 캔버스: 보드 전체를 폭에 맞춰 그린다. 쌓인 이름이 보이도록 위쪽 범위를 넓힌다. dirty일 때만 다시 그리고, 풍차는 고정 각도로 그린다.
  - **출발 위치**
    - 보드를 좌우로 끌면 상대 이동하고, 탭하면 그 x로 바로 이동한다. ◀ ▶ 버튼은 0.25m씩 움직인다.
    - `drop` 전송은 100ms로 스로틀한다.
    - 내 이름에서 아래로 가이드 점선을 그린다.
  - **장애물**
    - 종류 버튼(벽돌/트램펄린/범퍼) + ⟲ ⟳(15°) + "여기에 설치" + 내 장애물 목록(삭제).
    - 편집 대상은 하나뿐이다. 빈 곳을 탭하면 고스트가 그곳으로 이동하고, 드래그하면 손가락 이동량만큼 상대 이동한다(손가락에 가리지 않게).
    - 내 장애물을 탭하면 그 장애물을 편집한다.
    - 바뀔 때마다 `validateObstacle`로 즉시 검사해서 상태 줄에 사유를 띄우고 고스트를 빨강/초록으로 표시한다.
    - 맵 요소 주변 금지 구역을 옅은 빨간 후광으로 보여준다.
  - "준비 완료" 토글(켜지면 teal). 준비한 뒤에도 수정은 가능하다.
- **pRun**: "큰 화면을 보세요". `mine`을 받으면 바로 **pDone**에 큰 글씨로 결과를 표시한다.
- `kicked`: "호스트가 내보냈어요"를 띄우고 재연결하지 않는다.

### 6. 디자인 토큰 (style.css에 반영됨)
- 핀볼 캐비닛의 밤 분위기.
  - 잉크: `#1B1530 / #140F26 / #221A3E / #2F2652`, 라인 `#463B73`
  - 크롬: `#C9CEDD`
  - **레이저: `#FF3B5C`(결승선 전용)**
  - 앰버: `#FFB547`(주요 버튼, "나" 강조)
  - 틸: `#4FD1C5`(준비, 트램펄린)
- 폰트: 표시용·이름은 **Black Han Sans**, UI는 **IBM Plex Sans KR**.
- 브랜드 마크는 **칸으로 끊긴 레이저 선**이다(`.title::after`).
- 금지: 대문자 eyebrow 라벨, 버튼 텍스트 뒤 "→", 장식용 그라디언트, 가운뎃점으로 이어 붙인 메타 문자열.

### DOM ID (style.css가 전제하는 구조)
- 호스트
  - 레이아웃: `.host > .stage(#board, #banner.banner, #overlay.overlay > .result-card) + aside.panel`
  - `#hSetup`: `#labels #labelsHint #obsMinus #obsOut #obsPlus #blind #setupErr #openRoom`, `details.joinbox`
  - `#hLobby`: `.lobby-head #net`, `.join > .qr-box > #qr`, `#code #joinUrl`, `.counts #cPlayers #cReady #cSlots`, `#plist`, `#addForm #addName`, `#lobbyErr #startBtn #editSetup`
  - `#hRun`: `#clock #runSub #results #camBtn #soundBtn #abortBtn`
  - 결과: `#finalList #leftover #againBtn #copyBtn #resetBtn`
- 폰
  - 레이아웃: `.phone > header.p-head(#pCode #pNet #pMe > #pMeName) + main#pMain`
  - `#pTabs`, `#pCanvas.p-canvas`
  - 출발 위치: `#pDropTools(.nudge #pLeft #pRight)`
  - 장애물: `#pObsTools(#pKinds, #pObsStatus, .place-row #pRotL #pRotR #pPlace, #pMyObs)`
  - 준비: `#pReady.btn.big.ready`
  - 진행·결과: `#pRunMe #pRunMsg #pDoneMe #pLabel #pDoneMsg`
  - 연결·오류: `#pConnMsg #pErrMsg #pRetry`
  - 이름 입력: `#pNameInput #pNameErr`

---

## 테스트 방법

```bash
npm install            # devDependencies: planck, peerjs, qrcode-generator, playwright
npm test               # 헤드리스 200판: fails=0이어야 함. sim.js 수정 후 필수 (fixtures가 있으면 실제 글자 모양 사용)
node test/headless.js 400 7 --players 30 --extra 0 --obs 2 [--mode block] [--crowd] [--synth]
npm run stress         # 30명 × 2000판을 CPU 코어 수만큼 병렬로 (test/stress.js)
npm run serve          # http://localhost:8080 (node test/server.js)
npm run e2e            # 호스트 1 + 폰 30, 가짜 PeerJS, 두 판 (+ --resilience: 호스트 새로고침·폰 끊김·강퇴·폰 없는 사람)
npm run e2e:real       # 진짜 PeerJS 서버 + WebRTC, 폰마다 별도 컨텍스트. --url <배포 주소>면 배포된 사이트와 실제 CDN으로
node test/host-perf.js 30 2        # 폰 없는 사람 30명으로 호스트 fps 측정 (단독으로 돌릴 것)
node test/browser-batch.js 160     # 브라우저 안에서 30명 판을 대량으로 (실제 폰트·브라우저 엔진)
npm run glyphs         # 실제 글자 모양 다시 뽑기 → test/fixtures/names.json
```
- Playwright는 설치된 Edge(`channel: 'msedge'`)를 쓴다. 없으면 기본 Chromium(`npx playwright install chromium`). `BROWSER_CHANNEL`로 바꿀 수 있다.
- **E2E (Playwright)**
  - `test/fakepeer.js`: BroadcastChannel로 Peer와 DataConnection API를 흉내 낸다. 메시지 지연(3~25ms, 순서 보장), json 16300바이트 한도, `__fp.sever()/heal()`(이벤트 없는 네트워크 단절) 지원.
  - `page.route`로 jsdelivr의 peerjs 요청을 fakepeer로 가로챈다. planck와 qrcode는 `node_modules`의 파일로 응답한다(CDN 파일과 바이트 단위로 같음).
  - 가짜 모드는 한 컨텍스트라 localStorage를 같이 쓰므로 `addInitScript`로 폰마다 `plb.cid`를 다르게 준다.
  - 백그라운드 탭은 rAF가 멈추므로 보드를 탭하기 전에 `bringToFront()`, 게임 중에는 호스트 탭을 앞에 둔다.
  - 결과물: `test/out/<fake|real>/` 스크린샷 + `report.json`.
- **실기기 테스트는 GitHub Pages에 배포한 뒤에** 한다. 폰은 LTE와 와이파이 둘 다 시험한다.

## GitHub Pages 배포
1. 저장소 루트에 `index.html`, `src/`, `.nojekyll`이 있으면 된다. 빌드 단계는 없다.
2. Settings → Pages → Deploy from a branch → `main` / root.
3. 주소: `https://<아이디>.github.io/<저장소>/`. 참가 QR은 이 주소에 `?room=`을 붙여 자동으로 만든다.
4. `node_modules`는 커밋하지 않는다(.gitignore). 브라우저는 CDN에서 라이브러리를 받는다.

## 알려진 위험·메모
- PeerJS 공용 서버는 무료라 가끔 불안정하다. 회사나 학교 방화벽에서는 TURN을 거쳐도 실패할 수 있다. 화면에 상태를 명확히 표시하고, 폰 없는 사람 수동 추가로 대체할 수 있게 한다.
- Google Fonts가 막힌 환경에서는 대체 폰트로 모양을 추출한다. 그리기도 같은 폰트 스택을 쓰므로 모양과 그림은 일치한다.
- 맵 튜닝은 `buildMap()`에서 한다. 핀 간격(행 안 6m)은 이름 최대 폭 4.6m보다 넓게 유지한다(이름이 핀 두 개에 걸쳐 멈추는 것 방지).
- 옆벽에 붙어 미끄러지는 문제는 y=12.6의 짧은 턱(deflector)으로 해결했다. 맵을 바꾸면 헤드리스로 재확인한다.
