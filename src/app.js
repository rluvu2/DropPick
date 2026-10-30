/* 핀볼 사다리 — 부트스트랩: ?room=XXXX 있으면 폰(참가자), 없으면 PC(호스트) */
(function (root) {
  'use strict';
  const q = new URLSearchParams(location.search);
  const isPhone = q.has('room');
  const room = root.Net ? root.Net.normCode(q.get('room')) : '';

  function fatal(msg) {
    document.body.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'p-center fatal';
    const h = document.createElement('h1');
    h.className = 'title small';
    h.textContent = '열 수 없어요';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = msg;
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = '새로고침';
    b.onclick = () => location.reload();
    box.append(h, p, b);
    document.body.appendChild(box);
  }

  // CDN 스크립트가 막힌 환경 (회사·학교 방화벽 등)
  const need = isPhone ? ['planck', 'Peer'] : ['planck', 'Peer', 'qrcode'];
  const missing = need.filter(k => !root[k]);
  if (missing.length || !root.Sim || !root.Host || !root.Player) {
    fatal('필요한 파일을 불러오지 못했어요 (' + (missing.join(', ') || 'app') + '). 인터넷 연결을 확인하고 새로고침해주세요.');
    return;
  }
  if (isPhone && room.length !== 4) {
    fatal('참가 주소가 올바르지 않아요. 큰 화면의 QR을 다시 찍어주세요.');
    return;
  }

  const tpl = document.getElementById(isPhone ? 'tPhone' : 'tHost');
  document.body.appendChild(tpl.content.cloneNode(true));
  document.body.classList.add(isPhone ? 'is-phone' : 'is-host');
  root.Render.Assets.load(isPhone ? ['stage1'] : null);   // 있으면 쓰고 없으면 그림으로 대신 (assets/manifest.json). 폰은 1구간 바닥만 보여준다
  if (isPhone) root.Player.start(room);
  else root.Host.start();
})(typeof self !== 'undefined' ? self : this);
