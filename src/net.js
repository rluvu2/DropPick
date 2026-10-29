/* 핀볼 사다리 — PeerJS 래퍼 (호스트·참가자)
 * 공용 클라우드 서버(0.peerjs.com)만 쓴다. Peer에 config를 넘기지 않는다
 * (넘기면 PeerJS 기본 STUN/TURN 설정이 사라짐).
 */
(function (root) {
  'use strict';
  const PREFIX = 'pinball-ladder-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const HB_MS = 4000, HOST_STALE_MS = 14000, CLIENT_STALE_MS = 12000;
  const NET_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id'];
  // PeerJS의 json 직렬화는 16300바이트 이상 메시지를 조용히 버린다 (chunkedMTU)
  const MAX_BYTES = 16000;
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function makeCode() {
    let s = '';
    const buf = new Uint32Array(4);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(buf) : buf.forEach((_, i) => { buf[i] = Math.random() * 1e9; });
    for (let i = 0; i < 4; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return s;
  }
  function normCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  }
  function sizeOf(msg) {
    const s = JSON.stringify(msg);
    return enc ? enc.encode(s).length : s.length * 3;
  }
  function safeSend(conn, msg) {
    if (!conn || !conn.open) return false;
    const n = sizeOf(msg);
    if (n >= MAX_BYTES) { console.error('[net] 메시지가 너무 큼', msg.t, n + 'B'); return false; }
    try { conn.send(msg); return true; } catch (e) { return false; }
  }

  // ---------- 호스트 ----------
  /* h: { onStatus(level, text), onOpen(code), onCode(code), onJoin(conn), onData(conn, msg), onLeave(conn), onStale(conn) } */
  class HostNet {
    constructor(code, h) {
      this.code = code || makeCode();
      this.h = h;
      this.conns = new Set();
      this.idRetries = 0;
      this.backoff = 0;
      this.dead = false;
      this._open();
      this.hb = setInterval(() => this._beat(), HB_MS);
    }
    _open() {
      if (this.dead) return;
      this.h.onStatus('warn', '서버에 연결하는 중');
      const peer = this.peer = new root.Peer(PREFIX + this.code, { debug: 1 });
      peer.on('open', () => {
        if (peer !== this.peer) return;
        this.everOpen = true; this.idRetries = 0; this.backoff = 0;
        this.h.onStatus('ok', '참가 가능');
        this.h.onOpen(this.code);
      });
      peer.on('connection', conn => this._accept(conn));
      // 신호 서버와 끊겨도 이미 붙은 참가자 연결(WebRTC)은 살아 있다. 같은 Peer로 서버에만 다시 붙는다.
      peer.on('disconnected', () => {
        if (peer !== this.peer || this.dead || peer.destroyed) return;
        this.h.onStatus('warn', '서버 재연결 중 (참가자 연결은 유지)');
        this._restart();
      });
      peer.on('error', err => this._error(peer, err));
    }
    _error(peer, err) {
      if (peer !== this.peer || this.dead) return;
      const type = err && err.type;
      if (type === 'unavailable-id' && !this.everOpen) {
        // 새로고침 직후에는 이전 ID가 서버에 잠깐 남아 있을 수 있다 → 같은 코드로 2번 더, 그래도 안 되면 새 코드
        try { peer.destroy(); } catch (e) { /* 무시 */ }
        if (this.idRetries < 2) {
          this.idRetries++;
          this.h.onStatus('warn', '방코드를 다시 잡는 중');
          setTimeout(() => this._open(), 2500);
        } else {
          this.idRetries = 0;
          this.code = makeCode();
          this.h.onCode(this.code);
          this._open();
        }
      } else if (type === 'peer-unavailable' || type === 'webrtc') {
        // 참가자 한 명의 연결 문제라 방 전체와는 무관
      } else if (NET_ERRORS.includes(type)) {
        this.h.onStatus('bad', '서버 연결 끊김. 다시 시도하는 중');
        this._restart();
      } else {
        this.h.onStatus('warn', '연결 문제: ' + (type || '알 수 없음'));
      }
    }
    _restart() {
      if (this.retryTimer || this.dead) return;
      const ms = Math.min(15000, 1000 * Math.pow(1.6, this.backoff++));
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        const p = this.peer;
        if (this.dead || !p || p.open) return;
        if (!p.destroyed && p.disconnected) {
          try { p.reconnect(); } catch (e) { this._restart(); }   // 같은 ID로 재등록, 참가자 연결 유지
          return;
        }
        if (p.destroyed) this._open();   // 처음 연결부터 실패하면 PeerJS가 Peer를 버린다
      }, ms);
    }
    _accept(conn) {
      conn.lastSeen = Date.now();
      conn.on('open', () => { conn.lastSeen = Date.now(); this.conns.add(conn); this.h.onJoin(conn); });
      conn.on('data', msg => {
        conn.lastSeen = Date.now();
        if (conn.stale) { conn.stale = false; }
        if (!msg || typeof msg !== 'object' || msg.t === 'hb') return;
        this.h.onData(conn, msg);
      });
      const gone = () => { if (this.conns.delete(conn)) this.h.onLeave(conn); };
      conn.on('close', gone);
      conn.on('error', () => { /* close가 뒤따른다 */ });
    }
    _beat() {
      const now = Date.now();
      for (const c of this.conns) {
        safeSend(c, { t: 'hb' });
        if (!c.stale && now - c.lastSeen > HOST_STALE_MS) { c.stale = true; this.h.onStale(c); }
      }
    }
    send(conn, msg) { return safeSend(conn, msg); }
    drop(conn) {
      this.conns.delete(conn);
      setTimeout(() => { try { conn.close(); } catch (e) { /* 무시 */ } }, 300);
    }
    destroy() {
      this.dead = true;
      clearInterval(this.hb);
      clearTimeout(this.retryTimer);
      try { this.peer.destroy(); } catch (e) { /* 무시 */ }
    }
  }

  // ---------- 참가자 ----------
  /* h: { onStatus(level, text), onOpen(), onData(msg), onFail(kind) } */
  class ClientNet {
    constructor(code, h) {
      this.code = code;
      this.h = h;
      this.stopped = false;
      this.tries = 0;
      this.lastSeen = 0;
      this._peer();
      this.hb = setInterval(() => this._beat(), HB_MS);
      this._vis = () => { if (document.visibilityState === 'visible') this._check(true); };
      document.addEventListener('visibilitychange', this._vis);
      root.addEventListener('online', this._vis);
    }
    _peer() {
      if (this.stopped) return;
      clearTimeout(this.openTimer);
      this.h.onStatus('warn', '연결 중');
      const peer = this.peer = new root.Peer({ debug: 1 });
      // 9초 안에 서버에 못 붙으면 새로 시도
      this.openTimer = setTimeout(() => { if (peer === this.peer && !peer.open && !this.open) this._reset('서버 응답이 없어요. 다시 시도하는 중'); }, 9000);
      peer.on('open', () => {
        if (peer !== this.peer) return;
        clearTimeout(this.openTimer);
        this.sigBackoff = 0;
        if (!this.open) this._connect();   // 서버에만 다시 붙은 경우엔 살아 있는 데이터 연결을 그대로 쓴다
      });
      peer.on('disconnected', () => {
        if (peer !== this.peer || this.stopped || peer.destroyed) return;
        if (this.open) this._sigRetry(peer);
        else this._reset('서버 연결이 끊겼어요. 다시 연결하는 중');
      });
      peer.on('error', err => {
        if (peer !== this.peer || this.stopped) return;
        const type = err && err.type;
        if (type === 'peer-unavailable') {
          this.tries++;
          if (this.tries >= 3 && !this.everOpen) { this.h.onFail('noroom'); return; }
          this.h.onStatus('warn', '방을 찾는 중');
          setTimeout(() => { if (peer === this.peer && !this.open) this._connect(); }, 2000);
        } else if (type === 'browser-incompatible') {
          this.h.onFail('browser');
        } else if (this.open) {
          // 신호 서버 문제여도 호스트와의 데이터 연결이 살아 있으면 끊지 않는다
          if (NET_ERRORS.includes(type)) this._sigRetry(peer);
        } else {
          this._reset('연결이 끊겼어요. 다시 연결하는 중');
        }
      });
    }
    _sigRetry(peer) {
      if (this.sigTimer) return;
      this.sigBackoff = (this.sigBackoff || 0) + 1;
      const ms = Math.min(30000, 1000 * Math.pow(2, this.sigBackoff));
      this.sigTimer = setTimeout(() => {
        this.sigTimer = null;
        if (peer !== this.peer || this.stopped || peer.destroyed || !peer.disconnected) return;
        try { peer.reconnect(); } catch (e) { /* 다음 끊김 때 다시 */ }
      }, ms);
    }
    _connect() {
      if (this.stopped || !this.peer || this.peer.destroyed) return;
      this.connAt = Date.now();
      if (this.conn) { try { this.conn.close(); } catch (e) { /* 무시 */ } }
      const conn = this.conn = this.peer.connect(PREFIX + this.code, { serialization: 'json', reliable: true });
      if (!conn) { this._reset(); return; }
      const t = setTimeout(() => { if (conn === this.conn && !conn.open) this._reset('연결이 늦어요. 다시 시도하는 중'); }, 12000);
      conn.on('open', () => {
        if (conn !== this.conn) return;
        clearTimeout(t);
        this.everOpen = true; this.tries = 0;
        this.lastSeen = Date.now();
        this.h.onStatus('ok', '연결됨');
        this.h.onOpen();
      });
      conn.on('data', msg => {
        if (conn !== this.conn) return;
        this.lastSeen = Date.now();
        if (!msg || typeof msg !== 'object' || msg.t === 'hb') return;
        this.h.onData(msg);
      });
      conn.on('close', () => { if (conn === this.conn && !this.stopped) this._reset('연결이 끊겼어요. 다시 연결하는 중'); });
      conn.on('error', () => { /* close가 뒤따른다 */ });
    }
    _reset(text) {
      if (this.stopped || this.resetting) return;
      this.resetting = true;
      this.h.onStatus('bad', text || '다시 연결하는 중');
      const old = this.peer;
      this.conn = null;
      setTimeout(() => {
        this.resetting = false;
        try { if (old) old.destroy(); } catch (e) { /* 무시 */ }
        this._peer();
      }, 1200);
    }
    _beat() {
      if (this.stopped) return;
      if (this.conn && this.conn.open) safeSend(this.conn, { t: 'hb' });
      this._check(false);
    }
    _check(visible) {
      if (this.stopped || this.resetting) return;
      const open = this.conn && this.conn.open;
      if (open && Date.now() - this.lastSeen > (visible ? 6000 : CLIENT_STALE_MS)) this._reset('응답이 없어요. 다시 연결하는 중');
      else if (!open && visible && this.peer && this.peer.open && Date.now() - (this.connAt || 0) > 5000) this._connect();
    }
    send(msg) { return safeSend(this.conn, msg); }
    get open() { return !!(this.conn && this.conn.open); }
    stop() {
      this.stopped = true;
      clearInterval(this.hb);
      clearTimeout(this.openTimer);
      clearTimeout(this.sigTimer);
      document.removeEventListener('visibilitychange', this._vis);
      root.removeEventListener('online', this._vis);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* 무시 */ }
    }
  }

  root.Net = { PREFIX, CODE_CHARS, MAX_BYTES, makeCode, normCode, sizeOf, HostNet, ClientNet };
})(typeof self !== 'undefined' ? self : this);
