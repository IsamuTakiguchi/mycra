// ---- 中継サーバー経由の接続 (直接つながらないときの予備) ----
// スマホの回線と家の Wi-Fi など、ネットワークが違う端末同士は WebRTC で直接つながらないことがある。
// そのときは公開 MQTT ブローカー (WebSocket) を中継にしてメッセージをやりとりする。
// MQTT 3.1.1 の必要な部分 (接続・購読・QoS 0 の送受信・ping) だけを実装している。

const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const PREFIX = 'mycra/v1/';
const CHUNK = 32 * 1024; // 1 回に送る最大の文字数 (大きいメッセージは分割する)
const TIMEOUT = 15000; // この時間なにも届かなければ切断とみなす

export function brokerList() {
  const q = new URLSearchParams(location.search).get('relay');
  return q ? q.split(',').filter(Boolean) : DEFAULT_BROKERS;
}

function randomId(n = 10) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8Str(s) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type, body) {
  const len = [];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    len.push(d);
  } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = type;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

// 最小限の MQTT クライアント
class Mqtt {
  constructor(url) {
    this.url = url;
    this.handlers = new Map(); // topic -> fn(text)
    this.buf = new Uint8Array(0);
    this.packetId = 1;
    this.onclose = null;
    this.closed = false;
  }

  connect(timeout = 8000) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url, 'mqtt');
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { reject(new Error('timeout')); this.close(); }, timeout);
      this.onConnack = (ok) => {
        clearTimeout(timer);
        if (ok) {
          this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 20000);
          resolve(this);
        } else {
          reject(new Error('refused'));
          this.close();
        }
      };
      ws.onopen = () => {
        const body = [...utf8Str('MQTT'), 4, 0x02, 0, 60, ...utf8Str(`mycra_${randomId(12)}`)];
        this.raw(packet(0x10, body));
      };
      ws.onmessage = (e) => this.receive(new Uint8Array(e.data));
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error('closed'));
        this.shutdown();
      };
    });
  }

  raw(bytes) {
    if (this.ws?.readyState === 1) this.ws.send(bytes);
  }

  subscribe(topic, fn) {
    this.handlers.set(topic, fn);
    const id = this.packetId++ & 0xffff || 1;
    this.raw(packet(0x82, [id >> 8, id & 255, ...utf8Str(topic), 0]));
  }

  publish(topic, text) {
    this.raw(packet(0x30, [...utf8Str(topic), ...enc.encode(text)]));
  }

  receive(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    let pos = 0;
    while (pos + 2 <= b.length) {
      let len = 0, mul = 1, i = pos + 1, done = false;
      while (i < b.length && i < pos + 5) {
        const d = b[i++];
        len += (d & 127) * mul;
        mul *= 128;
        if (!(d & 128)) { done = true; break; }
      }
      if (!done || i + len > b.length) break;
      this.handle(b[pos], b.subarray(i, i + len));
      pos = i + len;
    }
    this.buf = b.slice(pos);
  }

  handle(header, body) {
    const type = header >> 4;
    if (type === 2) this.onConnack?.(body[1] === 0);
    else if (type === 3) {
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      let start = 2 + tlen;
      if ((header >> 1) & 3) start += 2; // QoS 1/2 のパケット ID
      this.handlers.get(topic)?.(dec.decode(body.subarray(start)));
    }
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping);
    this.onclose?.();
  }

  close() {
    try {
      this.raw(new Uint8Array([0xe0, 0]));
      this.ws?.close();
    } catch { /* すでに閉じている */ }
    this.shutdown();
  }
}

// PeerJS の DataConnection と同じ形 (open / send / close / on) の接続
class RelayConn {
  constructor(sendText) {
    this.sendText = sendText;
    this.open = false;
    this.relay = true;
    this.listeners = {};
    this.parts = new Map();
    this.lastSeen = performance.now();
  }

  on(ev, fn) {
    (this.listeners[ev] ??= []).push(fn);
  }

  emit(ev, arg) {
    for (const fn of this.listeners[ev] ?? []) fn(arg);
  }

  send(msg) {
    if (!this.open) return;
    const text = JSON.stringify(msg);
    if (text.length <= CHUNK) { this.sendText(`m${text}`); return; }
    const id = randomId(6);
    const n = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < n; i++) this.sendText(`p${id}|${i}|${n}|${text.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }

  // 届いた文字列を解釈する
  receive(text) {
    this.lastSeen = performance.now();
    if (text[0] === 'm') this.deliver(text.slice(1));
    else if (text[0] === 'p') {
      const [id, i, n] = text.slice(1).split('|', 3);
      const body = text.slice(1 + id.length + i.length + n.length + 3);
      let entry = this.parts.get(id);
      if (!entry) { entry = { got: 0, list: new Array(Number(n)) }; this.parts.set(id, entry); }
      if (entry.list[i] === undefined) { entry.list[i] = body; entry.got++; }
      if (entry.got === entry.list.length) {
        this.parts.delete(id);
        this.deliver(entry.list.join(''));
      }
    } else if (text === 'bye') this.close();
  }

  deliver(json) {
    let msg;
    try { msg = JSON.parse(json); } catch { return; }
    this.emit('data', msg);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.open) this.sendText('bye');
    this.open = false;
    this.emit('close');
  }
}

// ---- ホスト: 全ブローカーでルームを待ち受ける ----
export class RelayHost {
  constructor(code, onConnection) {
    this.code = code;
    this.onConnection = onConnection;
    this.clients = new Map(); // `${broker}|${clientId}` -> RelayConn
    this.brokers = [];
  }

  // 少なくとも 1 つのブローカーにつながれば true
  async start() {
    const results = await Promise.allSettled(brokerList().map(async (url) => {
      const m = await new Mqtt(url).connect();
      if (this.stopped) { m.close(); return; }
      this.brokers.push(m);
      m.subscribe(`${PREFIX}${this.code}/up`, (text) => this.receive(m, text));
    }));
    this.watch = setInterval(() => this.checkTimeouts(), 2000);
    return !this.stopped && results.some((r) => r.status === 'fulfilled') && this.brokers.length > 0;
  }

  receive(m, text) {
    const bar = text.indexOf('|');
    if (bar < 1) return;
    const cid = text.slice(0, bar);
    const body = text.slice(bar + 1);
    const key = `${m.url}|${cid}`;
    let conn = this.clients.get(key);
    if (!conn) {
      if (body === 'bye') return;
      conn = new RelayConn((t) => m.publish(`${PREFIX}${this.code}/dn/${cid}`, t));
      conn.on('close', () => this.clients.delete(key));
      this.clients.set(key, conn);
      conn.open = true;
      this.onConnection(conn);
    }
    conn.receive(body);
  }

  checkTimeouts() {
    const now = performance.now();
    for (const conn of [...this.clients.values()]) if (now - conn.lastSeen > TIMEOUT) conn.close();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watch);
    for (const conn of [...this.clients.values()]) conn.close();
    for (const m of this.brokers) m.close();
    this.brokers = [];
  }
}

// ---- 参加者: ブローカーを順に試してホストにつなぐ ----
// 接続できたら RelayConn を返す (ホストが応答するかは呼び出し側で確かめる)
export async function relayConnect(code, url) {
  const m = await new Mqtt(url).connect();
  const cid = randomId(10);
  const conn = new RelayConn((t) => m.publish(`${PREFIX}${code}/up`, `${cid}|${t}`));
  m.subscribe(`${PREFIX}${code}/dn/${cid}`, (text) => conn.receive(text));
  m.onclose = () => conn.close();
  conn.on('close', () => setTimeout(() => m.close(), 300));
  // ホストから一定時間なにも届かなければ切断とみなす
  const watch = setInterval(() => {
    if (conn.closed) clearInterval(watch);
    else if (performance.now() - conn.lastSeen > TIMEOUT) conn.close();
  }, 2000);
  conn.open = true;
  conn.broker = url;
  return conn;
}
