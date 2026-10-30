# 에셋 (선택)

이미지가 없어도 게임은 코드로 그린 그림으로 돌아갑니다. 아래 파일을 만들어 이 폴더에 넣고
`manifest.json`의 `images`에 파일 이름을 적으면 게임이 불러서 씁니다.

| 키 | 파일 이름 (권장) | 크기 | 어디에 쓰나 |
|---|---|---|---|
| `side` | `side.webp` | 512×2048 | 보드 양옆 빈 곳(대기실·설정 화면, 미니맵 뒤). 세로로 이어 붙이고 오른쪽은 좌우 반전 |
| `stage1`~`stage6` | `stage1.webp` … | 1024×1024 | 각 구간 바닥 무늬. 35% 투명도로 구간 색 위에 깔림 (1024px = 16m) |
| (아이콘) | `icon.png` | 1024×1024 | 파비콘·홈 화면 아이콘. 넣어 주면 index.html에 연결 |

공통 규칙: 글자·로고·사람·캐릭터 없음. 어둡고 대비가 낮을 것(위로 이름이 지나감).
기본 색: 바탕 `#140F26`·`#1B1530`, 네온 `#FF3B5C`(레이저 빨강) `#FFB547`(앰버) `#4FD1C5`(틸) `#E46BC4`(마젠타).

## Gemini 프롬프트

이미지 모델은 영어 프롬프트를 더 잘 따릅니다. 결과가 너무 밝으면 "darker, lower contrast"를 덧붙이세요.

### side (보드 옆 장식)
```
Vertical seamless tileable side panel artwork for a neon pinball arcade cabinet, tall 1:4 aspect ratio (512x2048).
Deep midnight purple background (#140F26 to #1B1530). Abstract geometric chrome rails running vertically,
small round rivets, a few tiny glowing indicator lights in neon red (#FF3B5C), amber (#FFB547), teal (#4FD1C5)
and magenta (#E46BC4). Subtle brushed-metal texture, soft vignette. Clean modern flat illustration style.
Mostly dark and low contrast so it stays in the background. The top and bottom edges must match perfectly
for seamless vertical tiling. No text, no letters, no logos, no characters, no people.
```

### stage1~6 (구간 바닥 무늬)
아래 틀에 구간별 {theme} {bg} {accent}를 바꿔 넣어 6장을 만듭니다.
```
Seamless tileable square texture, 1024x1024, used as the background of a game board.
Theme: {theme}. Very dark base color {bg} with faint {accent} accents.
Minimal, low contrast, soft, subtle pattern only (moving text will be drawn on top).
Clean modern flat style. Must tile seamlessly on all four edges.
No text, no letters, no logos, no characters, no people.
```
| 파일 | {theme} | {bg} | {accent} |
|---|---|---|---|
| stage1 (핀볼 숲) | faint constellation dots and thin connecting lines, like a night sky | #1B1530 | #8FB8FF |
| stage2 (지그재그 슬로프) | diagonal motion streaks and frosty speed lines, like a downhill slope | #111E35 | #4FD1C5 |
| stage3 (범퍼 정원) | an abstract neon garden of soft circular blossoms and rings | #21112E | #E46BC4 |
| stage4 (시계추 골짜기) | faint clockwork, thin gear outlines and arcs | #0D2127 | #7DE38D |
| stage5 (회전 원판) | concentric grooves like a vinyl record with faint radial rays | #22180F | #FFB547 |
| stage6 (레이저 커튼) | a fine laser grid with thin vertical curtain lines | #18122E | #C79BFF |

### icon (앱 아이콘)
```
App icon, 1024x1024, rounded square. A glossy chrome pinball dropping toward a glowing red (#FF3B5C) laser line
that is split into short segments, on a deep midnight purple (#140F26) background, with small amber (#FFB547)
and teal (#4FD1C5) neon highlights. Bold, simple shapes that stay readable at 32x32 pixels.
No text, no letters, no logos.
```

## manifest.json 예시
```json
{ "images": { "side": "side.webp", "stage1": "stage1.webp", "stage2": null } }
```
