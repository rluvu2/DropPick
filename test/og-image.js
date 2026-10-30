// 링크 미리보기 이미지(assets/og.jpg, 1200×630)를 실제 게임 화면으로 만든다.
//   node test/og-image.js
const path = require('path');
const fs = require('fs');
const { serve } = require('./server');
const { launch, routeCdn } = require('./browser');
const NAMES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'names.json'), 'utf8')).map(g => g.text);

(async () => {
  const server = await serve(0);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1590, height: 630 } });
  await routeCdn(ctx, { fake: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.fill('#labels', '커피 쏘기\n간식 쏘기\n꽝*22');
  await page.click('#openRoom');
  await page.waitForSelector('#hLobby:not(.hidden)');
  for (let i = 0; i < 24; i++) { await page.fill('#addName', NAMES[i]); await page.click('#addForm button'); }
  await page.click('#startBtn');
  // 무리가 지그재그 슬로프를 미끄러지는 장면
  await page.waitForFunction(() => PLB.st.game && PLB.st.game.t > 12.5 && PLB.st.focusY > 36, null, { timeout: 120000, polling: 100 });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:40px;top:34px;z-index:99;pointer-events:none';
    d.innerHTML = '<h1 class="title" style="font-size:76px;text-shadow:0 4px 18px rgba(0,0,0,.6)">핀볼 사다리</h1>' +
      '<p style="margin:14px 0 0;font-size:24px;font-weight:700;color:#F3EEFF;text-shadow:0 2px 10px rgba(0,0,0,.8)">이름이 글자 모양 그대로 떨어지는 사다리타기</p>';
    document.body.appendChild(d);
    document.getElementById('banner').style.display = 'none';
  });
  await page.waitForTimeout(120);
  const out = path.join(__dirname, '..', 'assets', 'og.jpg');
  await page.screenshot({ path: out, type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('saved', out, fs.statSync(out).size + 'B');
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
