// パーティー通信
//  ホストのブラウザが中継役になるスター型。PeerJS の公開サーバーで相手を見つけ、以降はブラウザ同士で直接通信する。
//  ?transport=local のときは BroadcastChannel で同じブラウザのタブ同士を同じ仕組みでつなぐ（動作確認用）。
const Party = (() => {
  const qs = new URLSearchParams(location.search);
  const PREFIX = 'ovice-race-speed-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX_MEMBERS = 8;
  const SILENT_MS = 12000; // これだけ何も届かない接続は切れたとみなす
  const listeners = {};
  const fire = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));

  const Party = {
    state: 'none', // none | connecting | open
    code: null,
    isHost: false,
    hostPid: null,
    members: [], // [{ pid, name, av }]（先頭がホスト）
    on(ev, fn) {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    create,
    join,
    leave,
    send,
    updateSelf,
  };

  let self = null; // { pid, name, av }
  let session = null; // 接続中の後片付け用
  const links = new Map(); // ホスト: pid -> link
  let hostLink = null; // メンバー: ホストへの link

  const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const normalizeCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  // ---------- 下回り（PeerJS / ローカル） ----------
  // link: { send(obj), onData(fn), onClose(fn), close(), last }
  function wrapPeerConn(conn) {
    const link = { last: Date.now(), dataFns: [], closeFns: [], closed: false };
    conn.on('data', d => { link.last = Date.now(); link.dataFns.forEach(f => f(d)); });
    const closed = () => { if (link.closed) return; link.closed = true; link.closeFns.forEach(f => f()); };
    conn.on('close', closed);
    conn.on('error', closed);
    link.send = d => { if (conn.open) { try { conn.send(d); } catch (e) {} } };
    link.onData = f => link.dataFns.push(f);
    link.onClose = f => link.closeFns.push(f);
    link.close = () => { try { conn.close(); } catch (e) {} closed(); };
    return link;
  }

  const peerTransport = {
    host(code, cb) {
      const peer = new Peer(PREFIX + code, { debug: 0 });
      peer.on('open', () => cb.ready());
      peer.on('connection', conn => conn.on('open', () => cb.conn(wrapPeerConn(conn))));
      peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
      peer.on('error', e => cb.error(e.type || String(e)));
      return () => peer.destroy();
    },
    join(code, cb) {
      const peer = new Peer({ debug: 0 });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => cb.open(wrapPeerConn(conn)));
      });
      peer.on('error', e => cb.error(e.type || String(e)));
      return () => peer.destroy();
    },
  };

  const localTransport = (() => {
    const ch = 'BroadcastChannel' in window ? new BroadcastChannel('ovice-race-speed-party') : null;
    const handlers = new Set();
    if (ch) ch.onmessage = ev => handlers.forEach(h => h(ev.data));
    const post = m => ch && ch.postMessage(m);
    function makeLink(code, me, peerId) {
      const link = { last: Date.now(), dataFns: [], closeFns: [], closed: false };
      const h = m => {
        if (m.code !== code || m.to !== me || m.from !== peerId) return;
        if (m.kind === 'data') { link.last = Date.now(); link.dataFns.forEach(f => f(m.d)); }
        if (m.kind === 'close') closed();
      };
      const closed = () => { if (link.closed) return; link.closed = true; handlers.delete(h); link.closeFns.forEach(f => f()); };
      handlers.add(h);
      link.send = d => !link.closed && post({ kind: 'data', code, from: me, to: peerId, d });
      link.onData = f => link.dataFns.push(f);
      link.onClose = f => link.closeFns.push(f);
      link.close = () => { post({ kind: 'close', code, from: me, to: peerId }); closed(); };
      return link;
    }
    return {
      host(code, cb) {
        const h = m => {
          if (m.code !== code) return;
          if (m.kind === 'probe') post({ kind: 'taken', code, to: m.from });
          if (m.kind === 'conn') {
            post({ kind: 'accept', code, from: 'host', to: m.from });
            cb.conn(makeLink(code, 'host', m.from));
          }
        };
        // 同じコードのホストがいないか確かめてから開く
        const me = 'p' + Math.random().toString(36).slice(2);
        const taken = m => { if (m.code === code && m.kind === 'taken' && m.to === me) { stop(); cb.error('unavailable-id'); } };
        handlers.add(taken);
        post({ kind: 'probe', code, from: me });
        const timer = setTimeout(() => { handlers.delete(taken); handlers.add(h); cb.ready(); }, 300);
        const stop = () => { clearTimeout(timer); handlers.delete(taken); handlers.delete(h); };
        return stop;
      },
      join(code, cb) {
        const me = 'c' + Math.random().toString(36).slice(2);
        const h = m => {
          if (m.code === code && m.kind === 'accept' && m.to === me) {
            handlers.delete(h);
            clearTimeout(timer);
            cb.open(makeLink(code, me, 'host'));
          }
        };
        handlers.add(h);
        post({ kind: 'conn', code, from: me });
        const timer = setTimeout(() => { handlers.delete(h); cb.error('peer-unavailable'); }, 1500);
        return () => { clearTimeout(timer); handlers.delete(h); };
      },
    };
  })();

  const transport = () => (qs.get('transport') === 'local' || !window.Peer ? localTransport : peerTransport);

  // ---------- パーティー ----------
  const ERRORS = {
    'peer-unavailable': 'そのコードのパーティーが見つかりません。コードを確認してください。',
    'unavailable-id': 'コードが重複しました。もう一度作成してください。',
    network: 'サーバーに接続できません。ネットワークを確認してください。',
    'server-error': 'サーバーに接続できません。しばらくしてから試してください。',
    'socket-error': 'サーバーとの接続が切れました。',
    'browser-incompatible': 'このブラウザは対応していません。',
    full: 'パーティーが満員です（最大 ' + MAX_MEMBERS + ' 人）。',
    timeout: '接続できませんでした。コードを確認するか、もう一度試してください。',
  };

  function setState(state) {
    Party.state = state;
    fire('state', state);
  }

  function reset() {
    if (session) session();
    session = null;
    // 先に参照を外してから閉じる（自分から抜けたときに「解散」扱いの通知を出さないため）
    const old = [...links.values()];
    links.clear();
    old.forEach(l => l.close());
    const hl = hostLink;
    hostLink = null;
    if (hl) hl.close();
    Object.assign(Party, { state: 'none', code: null, isHost: false, hostPid: null, members: [] });
  }

  function fail(type) {
    reset();
    fire('state', 'none');
    fire('error', ERRORS[type] || '接続エラー: ' + type);
  }

  function hostRoster() {
    Party.members = [self, ...[...links.values()].map(l => l.member).filter(Boolean)];
    const msg = { t: 'roster', code: Party.code, members: Party.members };
    links.forEach(l => l.send(msg));
    fire('roster', Party.members);
  }

  function create(me) {
    reset();
    self = { pid: me.pid, name: me.name, av: me.av || '' };
    const code = randomCode();
    Object.assign(Party, { code, isHost: true, hostPid: self.pid, members: [self] });
    setState('connecting');
    session = transport().host(code, {
      ready: () => {
        setState('open');
        fire('roster', Party.members);
      },
      conn: link => {
        link.onData(d => {
          if (!d || typeof d !== 'object') return;
          if (d.t === 'hello') {
            if (!link.member && links.size >= MAX_MEMBERS - 1) { link.send({ t: 'full' }); setTimeout(() => link.close(), 300); return; }
            const pid = String(d.pid);
            // ID が変わった場合（oVice の情報が後から届いたとき）は古い登録を消す
            links.forEach((l, k) => { if (l === link && k !== pid) links.delete(k); });
            // 同じ人がつなぎ直した場合は古い接続を閉じる
            const prev = links.get(pid);
            if (prev && prev !== link) { links.delete(pid); prev.close(); }
            link.member = { pid, name: String(d.name || '???').slice(0, 40), av: d.av || '' };
            links.set(pid, link);
            hostRoster();
          } else if (d.t === 'm' && link.member) {
            // メンバーからのメッセージは自分で処理して、他のメンバーへ中継する
            fire('message', { event: d.event, data: d.data });
            links.forEach(l => { if (l !== link) l.send(d); });
          }
        });
        link.onClose(() => {
          if (link.member && links.get(link.member.pid) === link) {
            links.delete(link.member.pid);
            fire('left', link.member.pid);
            hostRoster();
          }
        });
      },
      error: fail,
    });
  }

  function join(rawCode, me) {
    const code = normalizeCode(rawCode);
    if (code.length !== 4) return fire('error', 'パーティーコードは 4 文字です。');
    reset();
    self = { pid: me.pid, name: me.name, av: me.av || '' };
    Object.assign(Party, { code, isHost: false });
    setState('connecting');
    const timeout = setTimeout(() => fail('timeout'), 15000);
    const stop = transport().join(code, {
      open: link => {
        clearTimeout(timeout);
        hostLink = link;
        link.onData(d => {
          if (!d || typeof d !== 'object') return;
          if (d.t === 'roster') {
            Party.members = d.members || [];
            Party.hostPid = Party.members[0] && Party.members[0].pid;
            if (Party.state !== 'open') setState('open');
            fire('roster', Party.members);
          } else if (d.t === 'm') {
            fire('message', { event: d.event, data: d.data });
          } else if (d.t === 'full') {
            fail('full');
          }
        });
        link.onClose(() => {
          if (hostLink !== link) return;
          reset();
          fire('state', 'none');
          fire('error', 'パーティーが解散しました（ホストが退出したか、接続が切れました）。');
        });
        link.send({ t: 'hello', pid: self.pid, name: self.name, av: self.av });
      },
      error: type => { clearTimeout(timeout); fail(type); },
    });
    session = () => { clearTimeout(timeout); stop(); };
  }

  function leave() {
    if (Party.state === 'none') return;
    reset();
    fire('state', 'none');
  }

  function send(event, data = {}) {
    if (Party.state !== 'open' || !self) return;
    const msg = { t: 'm', event, data: Object.assign({}, data, { pid: self.pid }) };
    if (Party.isHost) links.forEach(l => l.send(msg));
    else if (hostLink) hostLink.send(msg);
  }

  // oVice の名前が後から分かった場合などに反映する
  function updateSelf(me) {
    if (!self) return;
    const oldPid = self.pid;
    self = { pid: me.pid, name: me.name, av: me.av || '' };
    if (Party.isHost) {
      if (Party.hostPid === oldPid) Party.hostPid = self.pid;
      hostRoster();
    } else if (hostLink) {
      hostLink.send({ t: 'hello', pid: self.pid, name: self.name, av: self.av });
    }
  }

  // 無言になった接続を切る（タブを閉じたのに close が届かない場合の保険）
  setInterval(() => {
    const now = Date.now();
    links.forEach(l => { if (now - l.last > SILENT_MS) l.close(); });
    if (hostLink && now - hostLink.last > SILENT_MS) hostLink.close();
  }, 2000);

  window.addEventListener('pagehide', () => leave());

  return Party;
})();
