// 브라우저에서 Glyph.trace로 실제 이름 모양을 뽑아 test/fixtures/names.json으로 저장한다.
// headless.js는 이 파일이 있으면 합성 모양 대신 이걸 쓴다.
//   node test/export-glyphs.js
const fs = require('fs');
const path = require('path');
const { serve } = require('./server');
const { launch, routeCdn } = require('./browser');

// 한글·영문·혼합·공백·8글자·좁은/넓은 글자·기호까지 섞은 샘플
const NAMES = [
  '김철수', '이영희', '박민준', '최지우', '정하늘', '강다은', '윤서준', '장미', '임꺽정', '한별',
  '서지민', '신동엽', '권보아', '황인준', '안유진', '송가인', '홍길동', '김', '남궁민수', '제갈공명',
  '독고영재', '빨리빨리', '무지개', '가나다라마바사아', '김수한무거북이', '뷁뷁뷁뷁뷁뷁뷁뷁', '쀍쀍', '의',
  'Alice', 'Bob', 'Charlie', 'Eve', 'Zoe', 'Jo', 'Max', 'Lily', 'A', 'Anna Lee', 'Jonathan', 'WWWWWWWW', 'iiiiiiii',
  '철수A', 'Kim민지', '2반 대장', 'BTS진', '박PD', '팀장 Lee', '아이유♥', '별⭐', '1등할래',
];

(async () => {
  const server = await serve(0);
  const browser = await launch();
  const ctx = await browser.newContext();
  await routeCdn(ctx, { fake: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.Glyph && window.Sim);
  const out = await page.evaluate(async names => {
    await Glyph.loadFont(names.join(''));
    await document.fonts.ready;
    return names.map(text => {
      const g = Glyph.trace(text);
      return {
        text, fontM: g.fontM, w: g.w, h: g.h, bw: g.bw, polys: g.polys,
        bhs: document.fonts.check('72px "Black Han Sans"', text),
      };
    });
  }, NAMES);
  const dir = path.join(__dirname, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'names.json'), JSON.stringify(out));
  for (const g of out) {
    const v = g.polys.reduce((s, p) => s + p.length, 0);
    console.log(`${g.text.padEnd(10)} font ${g.fontM.toFixed(2)}m  w ${g.w.toFixed(2)}  h ${g.h.toFixed(2)}  polys ${String(g.polys.length).padStart(2)}  verts ${v}${g.bhs ? '' : '  (대체 폰트)'}`);
  }
  console.log(`saved ${out.length} names → test/fixtures/names.json`);
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
