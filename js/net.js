// 通信レイヤー
//  - oVice カスタムオブジェクト内: window.parent との postMessage（ovice_broadcast_message）で全員に中継
//  - それ以外（ローカル確認用）: BroadcastChannel で同じブラウザの別タブ同士をつなぐ
const Net = (() => {
  const listeners = {};
  const qs = new URLSearchParams(location.search);
  let channel = null;

  const Net = {
    mode: 'connecting', // connecting | ovice | local
    self: { pid: null, name: '', avatarUrl: '' },
    participants: [],
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    send(event, data = {}) {
      if (!Net.self.pid) return;
      const message = Object.assign({}, data, { pid: Net.self.pid });
      if (Net.mode === 'ovice') {
        postToOvice('ovice_broadcast_message', { event, message });
      } else if (Net.mode === 'local' && channel) {
        channel.postMessage({ event, message });
      }
    },
    connect,
  };

  function fire(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function setSelf(p) {
    const pid = 'u' + p.id;
    const changed = Net.self.pid !== pid || Net.self.name !== p.name;
    Net.self = { pid, name: p.name || 'ゲスト', avatarUrl: p.avatarUrl || '' };
    if (changed) fire('self', Net.self);
  }

  function normalize(p = {}) {
    return {
      id: p.id != null ? String(p.id) : null,
      name: (p.name || '').replace(/\s+/g, ' '),
      avatarUrl: p.avatarUrl || '',
      status: p.status,
      isSelf: !!p.isSelf,
      isHost: !!p.isHost,
    };
  }

  // ---------- oVice ----------
  function postToOvice(type, payload) {
    window.parent.postMessage(payload === undefined ? { type } : { type, payload }, '*');
  }

  // oVice からのメッセージなら true を返す
  function handleOvice(ev) {
    if (ev.source !== window.parent) return false;
    const d = ev.data;
    if (!d || typeof d.type !== 'string' || !d.type.startsWith('ovice_')) return false;
    switch (d.type) {
      case 'ovice_confirmation':
        postToOvice('ovice_ready_confirmed');
        break;
      case 'ovice_participants': {
        Net.participants = (d.payload || []).filter(p => p && p.id != null).map(normalize);
        const self = Net.participants.find(p => p.isSelf);
        if (self) setSelf(self);
        fire('participants', Net.participants);
        break;
      }
      case 'ovice_participant_subscribed':
      case 'ovice_participant_unsubscribed':
      case 'ovice_participant_joined':
      case 'ovice_participant_left': {
        const p = normalize(d.payload);
        if (p.isSelf && p.id) setSelf(p);
        // サンプル実装に倣い、変化があったら少し待って参加者一覧を取り直す
        clearTimeout(handleOvice.timer);
        handleOvice.timer = setTimeout(() => postToOvice('ovice_get_participants'), 1000);
        break;
      }
      case 'ovice_message': {
        const m = d.payload || {};
        const data = m.message || {};
        // 自分の送信のエコーは無視
        if (!(data.pid && data.pid === Net.self.pid)) fire('message', { event: m.event, data });
        break;
      }
    }
    return true;
  }

  // ---------- ローカル ----------
  function startLocal() {
    Net.mode = 'local';
    const room = qs.get('room') || 'default';
    const name = qs.get('name') || 'Player-' + randomId().slice(0, 4).toUpperCase();
    Net.self = { pid: 'l' + randomId(), name, avatarUrl: '' };
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('ovice-race:' + room);
      channel.onmessage = ev => {
        const { event, message } = ev.data || {};
        if (message && message.pid !== Net.self.pid) fire('message', { event, data: message });
      };
    }
    fire('self', Net.self);
  }

  function connect() {
    const inIframe = window.parent !== window;
    if (!inIframe || qs.get('local') === '1') {
      startLocal();
      return Promise.resolve(Net.mode);
    }
    return new Promise(resolve => {
      let alive = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (alive) {
          Net.mode = 'ovice';
          // 自分の ID が取れなかった場合でも、乱数 ID で対戦はできるようにする
          if (!Net.self.pid) {
            Net.self = { pid: 'r' + randomId(), name: 'ゲスト', avatarUrl: '' };
            fire('self', Net.self);
          }
        } else {
          startLocal();
        }
        resolve(Net.mode);
      };
      window.addEventListener('message', ev => {
        if (!handleOvice(ev)) return;
        alive = true;
        if (Net.self.pid) finish();
      });
      postToOvice('ovice_get_participants');
      // 応答が遅いときのために何度か問い合わせる
      let tries = 0;
      const retry = setInterval(() => {
        if (done || ++tries > 5) return clearInterval(retry);
        postToOvice('ovice_get_participants');
      }, 500);
      setTimeout(finish, 3000);
    });
  }

  return Net;
})();
