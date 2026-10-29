# 핀볼 사다리

이름이 **글자 모양 그대로** 떨어지는 핀볼형 사다리타기 파티 게임입니다.
큰 화면(PC)에서 방을 열고, 참가자는 폰으로 QR을 찍어 들어와 출발 위치와 장애물을 정합니다.
바닥의 **레이저 결승선** 칸을 통과하면 그 칸이 결과로 확정됩니다. 확정된 칸은 사라지고 이웃 칸이 자리를 메우기 때문에 한 칸에 두 명이 들어갈 수 없고, 판은 반드시 끝납니다.

- 최대 30명, 칸 30개
- 서버 없음: GitHub Pages(정적 파일) + PeerJS 공용 서버(`0.peerjs.com`)로 폰과 PC를 연결
- 물리는 PC에서만 돌고 폰은 컨트롤러 역할만 합니다

## 하는 법

1. PC에서 사이트를 열고 바닥 칸 이름을 적습니다. 줄바꿈이나 쉼표로 구분하고, `꽝*3`처럼 쓰면 같은 칸이 3개 생깁니다.
2. 1인당 장애물 수(0~5)를 정하고 **방 열기**를 누릅니다.
3. 참가자는 QR을 찍어 이름을 정하고, 보드를 끌어 출발 위치를 고르고, 장애물(벽돌, 트램펄린, 범퍼)을 놓은 뒤 **준비 완료**를 누릅니다.
   - 폰이 없는 사람은 PC 대기실에서 이름을 추가하고, 보드에서 이름을 끌어 위치를 정할 수 있습니다.
4. PC에서 **시작**. 결과는 큰 화면과 각자의 폰에 동시에 표시됩니다.

판이 끝나지 않는 일을 막는 장치:
- 2초 이상 끼이면 단계적으로 튕기기 → 장애물 통과 → 빈 곳으로 순간이동
- 7초 동안 더 내려가지 못하면(풍차에 실려 돌기 등) 잠깐 유령 상태로 빠져나감
- 45초 서든데스: 유저 장애물 전부 파괴 + 중력 1.6배
- 75초 마무리: 남은 이름은 모든 충돌을 무시하고 떨어짐

## GitHub Pages 배포

빌드 단계가 없습니다. 저장소 루트의 `index.html`, `src/`, `.nojekyll`이 그대로 사이트가 됩니다.

1. Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: **main** / **(root)**
2. 1~2분 뒤 `https://<아이디>.github.io/<저장소>/`로 접속합니다.
3. 참가 QR은 이 주소에 `?room=방코드`를 붙여 자동으로 만들어집니다.

`file://`나 `localhost`로 열면 PC 화면은 확인할 수 있지만 폰에서는 들어올 수 없습니다.

## 개발·테스트

```bash
npm install                       # planck, peerjs, qrcode-generator, playwright (테스트용)
npm test                          # 물리 헤드리스 200판: fails=0 이어야 함 (sim.js 수정 후 필수)
npm run serve                     # http://localhost:8080
npm run e2e                       # 호스트 1 + 폰 30, 가짜 PeerJS로 두 판 진행 (Edge/Chromium 필요)
npm run e2e:real                  # 진짜 PeerJS 서버 + WebRTC로 같은 시나리오
npm run stress                    # 30명 × 2000판 물리 스트레스 (CPU 코어 수만큼 병렬)
node test/export-glyphs.js        # 브라우저에서 실제 글자 모양을 뽑아 test/fixtures/names.json 갱신
```

- `test/headless.js [판 수] [시드] --players 30 --extra 0 --obs 2 --mode random|block`
- `test/fixtures/names.json`이 있으면 헤드리스 테스트가 합성 모양 대신 실제 글자 모양을 씁니다. `--synth`로 끌 수 있습니다.
- E2E 결과(스크린샷, report.json)는 `test/out/`에 저장됩니다.

## 알려진 제약

- PeerJS 공용 서버는 무료라 가끔 느리거나 불안정합니다. 회사·학교 방화벽에서는 연결이 안 될 수 있으니, 그럴 땐 폰 없는 사람 추가로 진행하세요.
- 게임 중에는 PC 브라우저 탭을 화면에 띄워 두세요. 탭이 가려지면 브라우저가 애니메이션을 멈춰 게임이 느려집니다.
- "마블 룰렛"(lazygyu/roulette)에서 아이디어를 얻었지만 코드와 이름은 별개입니다.
