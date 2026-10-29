/* 테스트용 가짜 PeerJS — 같은 브라우저 컨텍스트의 탭끼리 BroadcastChannel로 통신한다.
 * PeerJS 1.5의 Peer / DataConnection API 중 앱이 쓰는 부분만 흉내 낸다.
 *  - json 직렬화는 16300바이트 이상이면 진짜 PeerJS처럼 'message-too-big' 에러를 내고 버린다
 *  - 메시지마다 지연(기본 3~25ms)을 주되 순서는 지킨다 (reliable)
 *  - window.__fp.sever(): 모든 연결을 조용히 끊는다 (네트워크 단절 흉내, close 이벤트 없음)
 */
(function (root) {
  'use strict';
  const SIG = 'fakepeer-sig-v1';
  const MTU = 16300;
  const LAT = root.__FP_LATENCY || [3, 25];
  const enc = new TextEncoder();
  const stats = root.__fpStats = { sent: 0, bytes: 0, maxBytes: 0, maxType: '', tooBig: 0, byType: {} };
  const rid = () => Math.random().toString(36).slice(2, 10);
  const mkErr = (type, msg) => { const e = new Error(msg); e.type = type; return e; };

  class Emitter {
    constructor() { this._ev = {}; }
    on(ev, fn) { (this._ev[ev] = this._ev[ev] || []).push(fn); return this; }
    off(ev, fn) { this._ev[ev] = (this._ev[ev] || []).filter(f => f !== fn); return this; }
    emit(ev, ...args) { for (const fn of (this._ev[ev] || []).slice()) { try { fn(...args); } catch (e) { setTimeout(() => { throw e; }); } } }
  }

  const peers = new Set();   // 이 탭의 Peer들
  const sig = new BroadcastChannel(SIG);
  sig.onmessage = e => { for (const p of [...peers]) p._sig(e.data); };
  // BroadcastChannel은 보낸 객체에는 전달하지 않으므로 같은 탭의 다른 Peer에게는 직접 전달
  function post(m) {
    if (severed) return;
    sig.postMessage(m);
    setTimeout(() => { for (const p of [...peers]) if (p._uid !== m.uid) p._sig(m); }, 0);
  }

  let severed = false;

  class DataConnection extends Emitter {
    constructor(provider, peerId, connId, opts, outgoing) {
      super();
      opts = opts || {};
      this.provider = provider; this.peer = peerId; this.connectionId = connId; this.label = connId;
      this.metadata = opts.metadata; this.serialization = opts.serialization || 'binary'; this.reliable = !!opts.reliable;
      this.open = false; this._closed = false; this._q = []; this._lastAt = 0;
      this._side = outgoing ? 'a' : 'b';
      this._ch = new BroadcastChannel('fakepeer-dc-' + connId);
      this._ch.onmessage = e => this._recv(e.data);
    }
    _ready() {
      setTimeout(() => {
        if (this._closed) return;
        this.open = true;
        this.emit('open');
        const q = this._q; this._q = [];
        for (const m of q) this._recv(m);
      }, 30 + Math.random() * 60);
    }
    _recv(m) {
      if (this._closed || severed || m.from === this._side) return;
      if (m.close) { this._gone(); return; }
      if (!this.open) { this._q.push(m); return; }
      this.emit('data', 's' in m ? JSON.parse(m.s) : m.d);
    }
    send(data) {
      if (!this.open) { this.emit('error', mkErr('not-open-yet', 'Connection is not open.')); return; }
      let payload, bytes = 0;
      if (this.serialization === 'json') {
        const s = JSON.stringify(data);
        bytes = enc.encode(s).byteLength;
        if (bytes >= MTU) {
          stats.tooBig++;
          this.emit('error', mkErr('message-too-big', 'Message too big for JSON channel'));
          return;
        }
        payload = { s };
      } else payload = { d: data };
      const t = data && data.t ? data.t : '?';
      stats.sent++; stats.bytes += bytes;
      stats.byType[t] = (stats.byType[t] || 0) + 1;
      if (bytes > stats.maxBytes) { stats.maxBytes = bytes; stats.maxType = t; }
      if (severed) return;
      const now = performance.now();
      const at = Math.max(this._lastAt, now + LAT[0] + Math.random() * (LAT[1] - LAT[0]));
      this._lastAt = at;
      setTimeout(() => { if (!this._closed && !severed) this._ch.postMessage(Object.assign({ from: this._side }, payload)); }, at - now);
    }
    close() {
      if (this._closed) return;
      if (!severed) try { this._ch.postMessage({ from: this._side, close: true }); } catch (e) { /* 무시 */ }
      this._gone();
    }
    _gone() {
      if (this._closed) return;
      this._closed = true;
      const was = this.open;
      this.open = false;
      setTimeout(() => { try { this._ch.close(); } catch (e) { /* 무시 */ } }, 200);
      if (this.provider) this.provider._conns.delete(this.connectionId);
      if (was) this.emit('close');
    }
  }

  class Peer extends Emitter {
    constructor(id, opts) {
      super();
      if (id && typeof id === 'object') { opts = id; id = null; }
      this._want = id || 'fp-' + rid() + rid();
      this._uid = rid();
      this.id = null; this.open = false; this.disconnected = false; this.destroyed = false;
      this._conns = new Map();
      peers.add(this);
      setTimeout(() => this._claim(), 0);
    }
    _claim() {
      if (this.destroyed) return;
      const nonce = rid();
      this._nonce = nonce; this._taken = false;
      post({ type: 'claim', id: this._want, nonce, uid: this._uid });
      setTimeout(() => {
        if (this.destroyed || this._nonce !== nonce) return;
        if (this._taken) {
          this.emit('error', mkErr('unavailable-id', `ID "${this._want}" is taken`));
          if (!this._everOpen) this.destroy(); else this._disc();
          return;
        }
        this.id = this._want; this.open = true; this.disconnected = false; this._everOpen = true;
        this.emit('open', this.id);
      }, 120 + Math.random() * 120);
    }
    _sig(m) {
      if (this.destroyed || severed) return;
      if (m.type === 'claim') {
        if (m.uid !== this._uid && m.id === this._want && this.open) post({ type: 'taken', id: m.id, nonce: m.nonce, uid: this._uid });
      } else if (m.type === 'taken') {
        if (m.id === this._want && m.nonce === this._nonce) this._taken = true;
      } else if (m.type === 'offer') {
        if (m.to !== this.id || !this.open) return;
        const conn = new DataConnection(this, m.from, m.connId, m.opts, false);
        this._conns.set(m.connId, conn);
        post({ type: 'answer', connId: m.connId, to: m.from, from: this.id, uid: this._uid });
        this.emit('connection', conn);
        conn._ready();
      } else if (m.type === 'answer') {
        const c = this._conns.get(m.connId);
        if (c && m.to === this.id && !c._answered) { c._answered = true; c._ready(); }
      } else if (m.type === 'leave') {
        for (const c of [...this._conns.values()]) if (c.peer === m.id) c._gone();
      }
    }
    connect(id, opts) {
      if (this.destroyed || this.disconnected || !this.open) {
        this.emit('error', mkErr('disconnected', 'Cannot connect to new Peer after disconnecting from server.'));
        return undefined;
      }
      const connId = 'dc_' + rid() + rid();
      const conn = new DataConnection(this, id, connId, opts, true);
      this._conns.set(connId, conn);
      post({ type: 'offer', to: id, from: this.id, connId, opts: opts || {}, uid: this._uid });
      setTimeout(() => {
        if (!conn._answered && !conn._closed && !this.destroyed) this.emit('error', mkErr('peer-unavailable', 'Could not connect to peer ' + id));
      }, 1500);
      return conn;
    }
    _disc() {
      if (this.disconnected) return;
      this.disconnected = true; this.open = false;
      this.emit('disconnected', this._want);
    }
    disconnect() { this._disc(); }
    reconnect() {
      if (this.destroyed) throw new Error('This peer cannot reconnect to the server. It has already been destroyed.');
      if (!this.disconnected) throw new Error('Peer ' + this.id + ' cannot reconnect because it is not disconnected from the server!');
      this.disconnected = false;
      this._claim();
    }
    destroy() {
      if (this.destroyed) return;
      for (const c of [...this._conns.values()]) c.close();
      if (this.id) post({ type: 'leave', id: this.id, uid: this._uid });
      this.destroyed = true; this.open = false; this.disconnected = true;
      peers.delete(this);
      this.emit('close');
    }
  }

  // 탭을 닫거나 새로고침하면 연결을 정리한다 (실제로는 WebRTC가 끊긴 걸 상대가 알아챔)
  root.addEventListener('pagehide', () => { for (const p of [...peers]) p.destroy(); });

  root.__fp = {
    sever() { severed = true; },
    heal() { severed = false; },
    peers: () => [...peers].map(p => ({ id: p.id, open: p.open, conns: p._conns.size })),
  };
  root.Peer = Peer;
  root.peerjs = { Peer, util: {} };
})(typeof self !== 'undefined' ? self : this);
