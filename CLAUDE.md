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
   - 45초 서든데스에 전부 파괴된다. (두 코스 모두. 긴 코스는 보통 그때 다들 1구간을 지나 있어서 조용히 지나간다)
7. 이름은 **글자 외곽선 모양 그대로** 물리 바디가 된다(공 모양 아님).
8. **코스는 PC 설정에서 고른다**: 긴 코스(기본, 6구간, 136m, 한 판 약 40초) / 짧은 코스(1구간, 31m, 약 20초).
   - 2026-10-29 사용자 요청: "마블룰렛을 참고해 더 길고 세련되게". 장르 수준의 연출(긴 코스, 카메라, 미니맵, 실시간 순위,
     파티클, 배속)만 참고하고, 맵 배치·그림·이름은 베끼지 않는다. 우리만의 정체성(글자 바디, 레이저 칸, 폰 장애물)은 유지.
   - 2026-10-30 사용자 요청: "마블룰렛처럼 더 화려하게(수익화 안 하니 많이 참조해도 됨)", "시작 전에는 맵 전체를", "도착 이펙트".
     → 화려함의 요소(검은 바탕의 강한 네온, 가까운 카메라, 전원 실시간 순위, 큰 당첨 연출)는 가져오되 우리 방식으로 새로 만들었다.
     그쪽 맵 배치·그림·화면 구성을 그대로 옮기거나 재현하지는 않는다(상표·저작물 문제 + 우리 게임의 정체성).
9. **시작 전 호스트 화면은 코스를 크게, 원하는 곳을 둘러볼 수 있게**(2026-10-30 사용자 요청): 보드 폭을 꽉 채운 큰 화면 + 왼쪽 미니맵(누르기·끌기로 이동),
   휠·끌기·확대, '코스 둘러보기'(출발→결승선 비행). 장애물 설치는 폰에서 하므로 1구간만 키울 필요 없음.
   (처음엔 코스 전체를 여러 단으로 나란히 보여줬는데 "작고 안 예쁘다"는 피드백으로 바꿈)
10. **설정·대기실 창은 보드 위에 떠 있는 창**(2026-10-30 사용자 요청, 마블룰렛식 플로팅). 접으면 방코드·인원만 보이는 작은 단추.

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
- 2차(2026-10-29 구현, 10-30 배포): 긴 코스 + 연출 — 아래 "긴 코스와 연출" 참고.
- 3차(2026-10-30): 네온 아케이드 연출 + 전체 지도 대기실 + 도착 이펙트 + Gemini 이미지 에셋 — 아래 "네온 연출 (3차)" 참고.

### 검증 결과 — 짧은 코스 (2026-10-29, 30명 · 실제 글자 모양 50종)
| 시나리오 | 판 수 | 안 끝난 판 | 45초 서든데스 | 75초 마무리 | 순간이동 나온 판 | 최장 |
|---|---|---|---|---|---|---|
| 장애물 1인 2개, 무작위 (평균 22.7개 설치) | 2000 | 0 | 0 | 0 | 7.4% | 34.4초 |
| 장애물 1인 5개, 무작위 (평균 25.5개) | 1000 | 0 | 0 | 0 | 5.9% | 31.5초 |
| 길막 시도: 납작한 벽돌·트램펄린 (평균 17.7개) | 1000 | 0 | 0 | 0 | 9.6% | 29.2초 |
| 30명이 전부 한가운데서 출발 | 1000 | 0 | 0 | 0 | 7.7% | 33.9초 |
| 브라우저(Edge) 안에서 실제 폰트로 실행, 장애물 2개 | 400 | 0 | 0 | 0 | 8.0% | 27.0초 |
- 합계 5400판 미종료 0 → 95% 신뢰 상한 약 0.06%. 소요 시간 p50 ≈ 17~19초, p99 ≈ 25~28초.
- 가벼운 끼임(2초 정지 → 튕기기)은 판의 87~93%에서 한 번 이상 나온다. 30명이 서로 얹히기 때문. 순환 탈출(7초 못 내려감)은 판의 22~26%.
- E2E(가짜 PeerJS, 호스트 1 + 폰 30, 두 판 + 복구 시나리오) 33개 항목 통과, 호스트 약 51fps.
- E2E(**배포된 사이트 + 진짜 PeerJS 클라우드 + WebRTC**, 폰 30대 각각 별도 컨텍스트, 실제 CDN) 전 항목 통과.
  호스트 새로고침 후 30대 재접속 2.4초, 호스트 약 50fps, 대기실 메시지 2.6KB.

### 검증 결과 — 긴 코스 (2026-10-29, 30명 · 실제 글자 모양 50종)
| 시나리오 | 판 수 | 안 끝난 판 | 45초 장애물 파괴(조용히) | 90초 가속 | 120초 마무리 | 순간이동 나온 판 | 최장 |
|---|---|---|---|---|---|---|---|
| 장애물 1인 2개, 무작위 (평균 22.7개) | 2000 | 0 | 3.7% | 0 | 0 | 7.7% | 55.9초 |
| 장애물 1인 5개, 무작위 (평균 25.5개) | 1000 | 0 | 5.2% | 0 | 0 | 6.2% | 54.4초 |
| 길막 시도: 납작한 벽돌·트램펄린 (평균 17.7개) | 1000 | 0 | 3.6% | 0 | 0 | 9.1% | 55.6초 |
| 30명이 전부 한가운데서 출발 | 1000 | 0 | 7.5% | 0 | 0 | 7.9% | 62.2초 |
- 합계 5000판 미종료 0 → 95% 신뢰 상한 약 0.06%. 소요 시간 p50 ≈ 38~39초, p99 ≈ 48~50초.
- 가벼운 끼임(튕기기)은 판의 89~95%, 순환 탈출은 31~36%(구간이 많아서 짧은 코스보다 조금 높음).
- 출발 x와 통과 x의 상관은 0.02 — 긴 코스는 거의 운이다(짧은 코스 0.46).
- 브라우저(Edge) 안에서 실제 폰트로 400판: 미종료 0, 최장 49.6초.
- E2E(가짜 PeerJS, 폰 30, 두 판 + 복구 시나리오) 34개 항목 통과, 호스트 약 56fps.
- 2026-10-30 E2E(**배포된 사이트 + 진짜 PeerJS + WebRTC**, 폰 30대, 긴 코스 두 판 + 복구 시나리오) 33개 항목 전부 통과.
  호스트 약 54fps, 새로고침 후 30대 재접속 2.5초, 대기실 메시지 2.6KB.
  한 번은 폰 하나가 PeerJS 서버에서 ID를 못 받았다(Failed to fetch). net.js가 새 Peer로 다시 붙어 그 폰도 두 판 다 결과를 받았다.
  테스트는 이런 PeerJS 서버 일시 오류를 콘솔 에러와 따로 센다(`test/browser.js` PEER_SERVER). 다른 검사(전원 입장·결과)가 통과하면 문제 아님.
- 호스트 fps(`host-perf.js`, 폰 없는 사람 30명, 긴 코스 3판, 단독 실행): 프레임 p50·p90 16.7ms, 진행 중 가장 느린 프레임 17ms.
  카운트다운에서 글자 모양 추출로 한 번 66ms. 10-29에 한 번 본 0.25초 멈춤은 다시 나오지 않았다(GC로 추정).

### 30명 검증에서 알게 된 것 (중요)
- **PeerJS json 직렬화는 16300바이트 이상 메시지를 조용히 버린다.** 객체 형식 lobby 메시지는 30명 × 장애물 5개에서 17KB를 넘는다 → 배열로 압축(아래 프로토콜). 30명 실측 2.6KB. `net.js`가 16000바이트 이상은 보내지 않고 콘솔 에러를 낸다. `fakepeer.js`도 같은 한도를 흉내 낸다.
- **이름을 매 프레임 회전된 텍스트로 그리면 30명에서 프레임당 100ms를 넘는다**(GPU 없는 환경). 이름마다 비트맵 스프라이트를 만들어 `drawImage`로 돌려 그린다(`render.js nameSprite`, 확대 배율이 바뀌면 프레임당 6개씩만 다시 만듦). 레이저 글로우도 `shadowBlur` 대신 넓은 반투명 선. → 헤드리스(소프트웨어 렌더링)에서도 30명 60fps.
- 물리 비용: 실제 글자 모양 30명 ≈ 스텝당 0.5~2ms (예산 8.3ms). 다른 무거운 작업과 CPU를 나눠 쓰면 크게 느려지므로 성능 측정은 단독으로 돌린다.
- **장애물 자리**: 설치 간격 규칙(맵 1.4m, 장애물끼리 1.5m) 때문에 보드에는 약 25~30개가 한계다. 30명 × 2개면 절반쯤만 놓인다. 빈자리가 없으면 폰에 "빈자리가 없어요"가 뜬다.
- 호스트 탭이 백그라운드가 되면 rAF가 멈춰 게임이 멈춘다. 테스트에서는 `bringToFront()`로 호스트 탭을 앞에 둔다.
- 대기실에서 쌓을 자리가 꽉 차(MAX_TIER) 옆으로 비켜 그려진 이름을 호스트 보드에서 끌면, 고른 x가 아니라 **그려진 자리 기준**으로 움직인다
  (놓은 곳 = 그려진 x + 끈 거리). E2E는 폰 없는 사람을 14명이 몰린 가운데에 둬서 이 경우를 일부러 만든다.
- 결과 카드는 목록만 스크롤하고 제목·버튼은 늘 보인다. 열 때마다 맨 위(당첨)부터 보인다. 예전엔 1판에서 내린 스크롤이 2판 결과에 남았다.

---

## 긴 코스와 연출 (2026-10-29 추가)

### 코스 (sim.js)
- `Sim.COURSES = { short, long }`, `Sim.buildMap(course)` → `{ id, W, F, els, stages:[{name,y0,y1}], timers:{sudden,rush,final}, view }`.
  - 인자 없이 `buildMap()`은 짧은 코스(기존 테스트 호환). 짧은 코스는 예전과 물리적으로 완전히 같다(헤드리스 수치 동일 확인).
  - 긴 코스 = 1구간(짧은 코스 그대로) + 2구간 지그재그 슬로프 + 3구간 범퍼 정원 + 4구간 시계추 골짜기(시계추·좌우 발판) + 5구간 회전 원판 + 6구간 레이저 커튼. F = 136.
  - 유저 장애물 구역은 1구간뿐이라 두 코스에서 검증 결과가 같다.
- 새 맵 요소(운동학 바디): `pendulum`(회전축에서 매달린 막대, 각도 = amp·sin), `slider`(기울어진 발판이 좌우로), `disc`(일정 속도로 도는 원판).
  `Sim.moverPose(el, t)`가 자세를 정하고, `Game._moveKinematics()`가 다음 스텝 자세에 정확히 닿도록 속도를 준다(오차 누적 없음). 대기실 그림도 같은 함수를 쓴다.
- 타이머는 코스별: 짧은 코스 sudden 45 / rush 45 / final 75 (예전과 같음), 긴 코스 sudden 45 / rush 90 / final 120.
  `sudden` = 유저 장애물 전부 파괴(이벤트에 `broke`, `busy` — busy는 구역에 이름이 남아 있었는지), `rush` = 중력 1.6배.
- 벽 밖으로 빠져나간 이름은 안으로 되돌린다(unstick level 8). `Sim.stageAt(map, y)`.
- **맵 설계 규칙(구슬이 아니라 최대 4.6m 막대라서)**: 통로·틈 6m 이상, 경사판 25° 이상, 움직이는 부품은 벽에서 6m 이상.
  **경사판 꼭대기 구석에 앞 경사판에서 날아온 이름이 떨어지면, 반대로 미끄러지려는 이름과 맞부딪혀 쌓인다(역류).**
  처음 지그재그(20°, 3단)에서 이름당 17.7초 체류 + 순간이동 37% → 27° 2단 + 구석을 50° 모서리판으로 메워 6.5초, 4.5%.
  맵을 바꾸면 끼임 위치를 꼭 확인한다(구조물별로 unstick 위치를 모으는 스크립트를 만들어 쓰면 빠르다).

### 화면 (render.js, host.js) — 3차에서 바뀐 부분은 아래 "네온 연출 (3차)"
- 구간별 테마(`Render.THEMES`: 그림이 없을 때의 바탕 그라디언트 + 네온 색), 구간 경계 점선과 큰 구간 제목.
- 폰 대기실: 긴 코스는 1구간 아래를 지그재그 절단선으로 자르고 결승선 띠를 바로 붙여 보여준다(`Render.LOBBY`, `cutText`). 호스트는 3차부터 전체 지도.
- 카메라(진행 중, '따라가기'): **가장 많이 모인 무리**를 따라간다. 지금 보는 무리를 유지하다가 다른 곳에 3명 이상 더 모이면 넘어간다.
  남은 이름이 셋 이하로 모이면 더 확대. '전체 보기'는 남은 이름 전부가 들어오게. 미니맵을 누르거나 끌면 4초 동안 그쪽을 본다.
- **결승선 카메라**: 긴 코스에서 누군가 결승선 16m 안에 들어왔는데 본 화면에 결승선이 안 보이면 아래 24% 띠에 결승선 근처를 따로 그린다(0.4초 유지될 때만 전환).
  본 화면은 띠에 가리는 만큼 내려서 무리가 가운데 오게.
- 미니맵(왼쪽 위 88px 세로 띠): 코스 정적 부분은 한 번 그려 두고 이름 점·카메라 창만 매 프레임.
- **당첨 칸**(가장 흔한 칸이 아닌 칸, `Render.specialLabels`): 결승선에서 앰버로 숨 쉬듯 빛나고, 들어가면 큰 당첨 화면(아래).

### 폰
- lobby·welcome·start 메시지에 `course`. 폰은 같은 `Sim.buildMap(course)`로 검증·그리기.
- 진행 중 호스트가 1초마다 `{t:'prog', p(0~1 진행도), r(지금 순위), s(구간), n(전체)}`를 보낸다 → "큰 화면을 보세요" 아래 순위 카드(진행 막대 + 구간 이름). 위치 스트리밍은 여전히 안 한다.
- 도구 주의: 파일을 쓸 때 정규식 안에 역슬래시-u-200b 같은 유니코드 이스케이프를 쓰면 실제 보이지 않는 문자로 바뀌어 문법 오류가 난 적이 있다(이 문서도 같은 일을 겪음). 문자 범위는 `codePointAt` 비교로 쓴다.

---

## 네온 연출 (3차, 2026-10-30)

### 그림
- 바탕은 거의 검정(`COL.void #06040D`) + 구간 그림(`assets/stage1~6.webp`). 그림은 **보드 폭 30m에 맞춰** 그리고, 구간이 그림보다 25% 넘게 길면(1구간뿐)
  세로로 이어 붙인다(위아래가 이어지게 만든 그림). 아니면 한 장을 구간 높이에 맞춰 늘린다. 그 위를 22% 어둡게 눌러 네온이 도드라지게.
- 벽·경사판·풍차·시계추 = **네온관**: 'lighter'로 넓고 옅은 빛 두 겹 + 색 관 + 흰 심(`render.js neon`). shadowBlur는 매 프레임 쓰지 않는다.
- 핀 = 구간 색으로 빛나는 금속 구 스프라이트. **이름이 세게(2.6m/s 이상) 부딪히면 하얗게 번쩍**(sim의 `spark` 이벤트 → `fx.light(el)`), 불꽃이 튄다.
- 이름 스프라이트에 이름 색 빛 번짐을 구워 둔다. 빛 번짐은 **1/4 해상도에서 흐리게 그려 늘린다**(큰 글자를 그대로 흐리면 스프라이트 하나에 수십 ms).
  확대 배율이 바뀌면 스프라이트를 다시 만드는데, 한 프레임에 4개까지(결승선 띠·전체 지도의 다른 단은 `keepBudget`으로 예산을 같이 씀).
- 1등(가장 앞선 이름) 위에 왕관. 꼬리는 'lighter'.

### 화면 구성 (호스트)
- **보드는 늘 화면 전체**(`.stage` absolute). 설정·대기실 창(`#panel`)은 그 위 오른쪽에 떠 있는 유리 창(내용 높이만큼, 넘치면 창 안에서 스크롤).
  `접기`(`#foldBtn`)로 접으면 `#panelPill`(방코드·인원·펼치기)만 남는다(`st.folded`, `.host.folded`). 좁은 화면(980px 이하)에서는 아래에서 올라오는 창.
- **시작 전 = 코스 둘러보기**(`host.js look`): 보드 폭을 안전 영역(왼쪽 미니맵 오른쪽 ~ 설정 창 왼쪽, `panelCover()`가 창 위치를 재서 구함)에 맞춘 큰 화면.
  - `look.cy·cx·zoomW` = 목표, `look.cur` = 실제(부드럽게 따라감). cy가 null이면 출발 지점(쌓인 이름 바로 위부터). 짧은 코스처럼 조금만 길면 한 화면에 다 들어오게 축소.
  - 휠 = 위아래, Ctrl(⌘)+휠·`−``+` = 확대·축소(커서 아래 지점 고정, 보이는 폭 12m ~ 보드 폭의 2.4배), 빈 곳 끌기 = 이동, 미니맵 누르기·끌기 = 그곳으로.
  - `코스 둘러보기`(`#tourBtn`): 보드 폭 전체로 출발 지점 → 결승선(초당 9m) → 1.4초 멈춤 → 출발 지점으로 되감기. 아무 조작이나 하면 멈춤.
  - 안내 문구(`#lookHint`)는 한 번 움직여 보면 숨기고 `localStorage 'plb.lookHint'`에 기억.
  - 미니맵은 대기실에서 더 넓게(최대 130px) 그리고 구간 이름을 적는다. 시작하면 `st.cam = st.lookRect`(보던 곳)에서 출발 지점으로 카메라가 다가간다.
  - `st.T`는 이 화면의 좌표 → 폰 없는 사람 이름 끌기(`hitLocal`)가 그대로 동작. 이름 위가 아닌 곳을 끌면 화면 이동.
- **진행 중 = 보드가 화면 전체**(`.host.racing`, 오른쪽 설정 판은 접힘). 오른쪽에 HUD(`#hud`: 버튼, 시계, **전원 순위판**), 왼쪽 위에 미니맵.
  보드는 둘 사이(안전 영역)에 오게 카메라 x를 맞춘다. HUD 폭은 `st.hudW`(화면 폭의 22%, 220~320px)를 CSS 변수 `--hud-w`로 넘긴다.
- 카메라는 무리의 좌우 폭(양 끝 10% 제외)에 맞춰 **보이는 폭 31m ~ 17m로 천천히 확대**(`st.zoomW`, 시간 상수 약 0.6초).
- 순위판(`#liveRank`, 4Hz + 도착 때 즉시): 도착한 이름(✓ 칸 이름, 당첨은 앰버) 다음에 떨어지는 이름을 지금 위치 순서로(구간 번호). 18명이 넘으면 `compact`.
- 카운트다운: 전체 지도 첫 단에서 출발 지점으로 카메라가 다가가며 3·2·1, 출발 때 '출발!'.
- 구간 진입: 가운데에 큰 구간 이름(`#stageTitle`, 투명도·이동만 애니메이션 — **filter를 움직이면 큰 빛 글자를 매 프레임 다시 그려 80ms 끊김**).
- **도착 이펙트**(확정마다): 결승선에서 빛기둥(이름 색), 빛 알갱이가 솟구침, 레이저를 따라 퍼지는 고리, 'n등'이 튀어 오름(가까이서 여럿이면 한 줄씩 위로).
- **당첨**: 화면 가운데 `#winFx`(당첨 + 이름 + 칸, 뒤를 어둡게 받침) 3.3초, 불꽃놀이 3발, 색종이, 화면 번쩍임·흔들림, 팡파르. 그동안 구간 제목은 건너뜀.
- 빨간 알림(`#banner`)은 서든데스·가속·마무리만.

### 성능 (호스트, 30명, 헤드리스 소프트웨어 렌더링)
- 프레임 p50·p90 16.7ms, p99 17ms, 진행 중 최대 33~50ms. 카운트다운 시작에 글자 모양 추출로 한 번 66~83ms.
- 호스트 코드가 한 프레임에 쓰는 시간(물리 포함) 평균 4.6~5.6ms / 16.7ms (`host-perf.js`의 `tickMs`).
- 3차 검증(2026-10-30): 가짜 PeerJS E2E 34개 통과(호스트 약 56fps), **배포 사이트 + 진짜 PeerJS** 폰 30대 E2E 33개 전부 통과.
  이때 호스트 48·36fps는 한 PC에 브라우저 31개(폰마다 별도 프로세스 + WebRTC)를 띄운 부하 때문. 호스트 혼자면 60fps.
- 그림은 불러올 때 `img.decode()`로 미리 풀어 둔다(처음 그릴 때 메인 스레드에서 풀면 수십 ms 멈춤).
- `st.stats.slowTicks`: 우리 코드가 한 프레임에 40ms 넘게 쓴 경우를 기록(점검용). 프레임 간격은 긴데 여기 없으면 브라우저 그리기(CSS 등) 쪽 문제.

### 이미지 에셋 (`assets/`)
- `side.webp`(512×2064), `stage1~6.webp`(1536 폭), `icon-32/64/192.png`(투명 모서리 파비콘), `icon-180.png`(홈 화면용, 꽉 찬 사각형).
- 원본은 `assets/originals/{side,stage1..6,icon}.png`(Gemini, git에 안 올림). `python test/build-assets.py`로 다시 만든다:
  - **Gemini 워터마크**: 오른쪽 아래(중심이 가장자리에서 112.5px)에 흰 별을 최대 50% 불투명도로 섞는다. 알파 지도(`test/fixtures/gemini-watermark.png`, 값×2)로
    섞기를 거꾸로 풀어(원래 = (보이는 색 − a×255)/(1 − a)) 밑그림을 그대로 되살린다. 흐리게 메우지 않음.
  - stage1만 위아래 이음매 처리(겹치는 띠를 두 그림이 가장 비슷한 경로로 잘라 붙임 — 섞지 않아서 무늬가 겹쳐 보이지 않음).
- 폰은 `stage1`만 불러온다(`Assets.load(['stage1'])`). 그림이 오면 `Assets.rev`가 올라가서 폰이 다시 그린다.

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
test/build-assets.py  Gemini 원본 → assets/ (워터마크 지우기, 이음매, 아이콘)
assets/             구간 그림·옆판·아이콘·링크 미리보기(og.jpg), manifest.json, README.md(프롬프트). originals/는 git에 안 올림
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
                       //  | {t:'unstick', id, level} | {t:'sudden', broke, busy} | {t:'rush'} | {t:'final'} | {t:'end'}
                       //  | {t:'spark', id, x, y, v, el, kind}]  ← 맵 구조물에 2.6m/s 이상으로 부딪힘 (화면용, 이름당 0.12초에 한 번, 물리 영향 없음)
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
{t:'lobby', players:[[id, name, color, x, w, fontM, flags, nObs]], obsPer, course, obstacles?:[[id, kind, x, y, a]], labels?:[...]}
  - flags: 1 준비, 2 온라인, 4 폰 없음. x는 각자 고른 출발 x(호스트가 clamp). 쌓인 위치(y, 옆으로 비킨 x)는
    폰이 같은 순서로 Sim.layoutStart를 돌려 직접 계산한다.
  - obstacles·labels는 바뀌었을 때만 넣는다(연결마다 obsRev·labRev 기억). 장애물 소유자는 id 앞부분('p3:o1' → 'p3').
  - labels는 블라인드면 전부 '?'. 숫자는 x·y 0.01, 각도 0.001로 반올림(검증한 값 그대로 보냄).
  - 배열인 이유: PeerJS json 채널의 16300바이트 한도 (위 "30명 검증" 참고).
{t:'obs-ok', id, op} | {t:'obs-bad', id, reason}     (id는 폰의 로컬 id)
{t:'start', course}  {t:'mine', label, seg, order}  {t:'end', results:[{name,color,label}]}
{t:'prog', p, r, s, n}   (진행 중 1초마다: 진행도 0~1, 지금 순위, 구간 번호, 전체 인원)
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
  - (3차) 보드가 화면 전체, 오른쪽 HUD: 경과 시간, "남은 이름 n / 남은 칸 m", 전원 순위판, 카메라 토글(따라가기/전체), 배속, 소리 토글, "중단하고 대기실로".
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
  - 잉크: `#1B1530 / #140F26 / #221A3E / #2F2652`, 라인 `#463B73`, 보드 바깥·바탕 `#06040D`(void)
  - 크롬: `#C9CEDD`
  - **레이저: `#FF3B5C`(결승선 전용)**
  - 앰버: `#FFB547`(주요 버튼, "나" 강조)
  - 틸: `#4FD1C5`(준비, 트램펄린)
- 폰트: 표시용·이름은 **Black Han Sans**, UI는 **IBM Plex Sans KR**.
- 브랜드 마크는 **칸으로 끊긴 레이저 선**이다(`.title::after`).
- 금지: 대문자 eyebrow 라벨, 버튼 텍스트 뒤 "→", 장식용 그라디언트, 가운뎃점으로 이어 붙인 메타 문자열.

### DOM ID (style.css가 전제하는 구조)
- 호스트
  - 레이아웃: `.host(.racing .folded) > .stage(#board, #hud, #lookTools(#zoomOut #zoomIn #tourBtn #lookHint), #stageTitle, #winFx(#winName #winLabel), #banner.banner, #overlay.overlay > .result-card) + aside#panel.panel(#foldBtn, 떠 있는 창) + #panelPill(#pillCode #pillInfo)`
  - `#hSetup`: `#labels #labelsHint #obsMinus #obsOut #obsPlus #blind #setupErr #openRoom`, `details.joinbox`
  - `#hLobby`: `.lobby-head #net`, `.join > .qr-box > #qr`, `#code #joinUrl`, `.counts #cPlayers #cReady #cSlots`, `#plist`, `#addForm #addName`, `#lobbyErr #startBtn #editSetup`
  - `#hud`(진행 중, 보드 위): `#camBtn #speedBtn #soundBtn #clock #runSub #liveWrap > #liveRank #abortBtn`
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
npm test               # 헤드리스 짧은 코스 200판 + 긴 코스 60판: fails=0이어야 함. sim.js 수정 후 필수 (fixtures가 있으면 실제 글자 모양)
node test/headless.js 400 7 --players 30 --extra 0 --obs 2 [--course long|short] [--mode block] [--crowd] [--synth]
npm run stress         # 긴 코스 30명 × 2000판을 CPU 코어 수만큼 병렬로 (stress:short는 짧은 코스)
npm run serve          # http://localhost:8080 (node test/server.js)
npm run e2e            # 호스트 1 + 폰 30, 가짜 PeerJS, 두 판 (+ --resilience: 호스트 새로고침·폰 끊김·강퇴·폰 없는 사람)
npm run e2e:real       # 진짜 PeerJS 서버 + WebRTC, 폰마다 별도 컨텍스트. --url <배포 주소>면 배포된 사이트와 실제 CDN으로
node test/host-perf.js 30 2        # 폰 없는 사람 30명으로 호스트 fps 측정 (단독으로 돌릴 것)
node test/browser-batch.js 160 --course long   # 브라우저 안에서 30명 판을 대량으로 (실제 폰트·브라우저 엔진)
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
