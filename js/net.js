// 通信レイヤー
//  - oVice カスタムオブジェクト内: window.parent との postMessage（ovice_broadcast_message）で全員に中継
//  - それ以外（ローカル確認用）: BroadcastChannel で同じブラウザの別タブ同士をつなぐ
const Net = (() => {
  const listeners = {};
  const qs = new URLSearchParams(location.search);
  const inIframe = window.parent !== window;
  let channel = null;
  let selfConfirmed = false; // oVice から自分の ID を受け取れたか

  const Net = {
    mode: 'connecting', // connecting | ovice | local
    self: { pid: null, name: '', avatarUrl: '' },
    participants: [],
    log: [], // 診断用：受信した oVice イベントの記録
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

  function addLog(text) {
    const d = new Date();
    const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    Net.log.push(ts + ' ' + text);
    if (Net.log.length > 40) Net.log.shift();
    fire('log', Net.log);
  }

  function setSelf(p) {
    if (!p.id) return;
    selfConfirmed = true;
    const pid = 'u' + p.id;
    const name = p.name || 'ゲスト';
    const changed = Net.self.pid !== pid || Net.self.name !== name || Net.self.avatarUrl !== p.avatarUrl;
    Net.self = { pid, name, avatarUrl: p.avatarUrl || '' };
    if (changed) {
      addLog(`自分を確定: ${name} (id ${p.id})`);
      fire('self', Net.self);
    }
  }

  // oVice のバージョン差に備えて、名前・ID のキー名を幅広く受け付ける
  function normalize(p = {}) {
    const id = p.id != null ? p.id : p.userId != null ? p.userId : p.user_id;
    const name = p.name || p.displayName || p.display_name || p.userName || p.user_name || p.nickname || '';
    return {
      id: id != null ? String(id) : null,
      name: String(name).replace(/\s+/g, ' ').trim(),
      avatarUrl: p.avatarUrl || p.avatar_url || p.avatar || '',
      status: p.status,
      isSelf: p.isSelf === true || p.is_self === true,
      selfUnknown: p.isSelf == null && p.is_self == null,
      isHost: !!p.isHost,
    };
  }

  // ---------- oVice ----------
  function postToOvice(type, payload) {
    window.parent.postMessage(payload === undefined ? { type } : { type, payload }, '*');
  }

  function switchToOvice() {
    if (Net.mode === 'ovice') return;
    // 応答が遅くてローカルモードに切り替わっていた場合も、oVice が応答したら戻す
    if (channel) { channel.close(); channel = null; }
    Net.mode = 'ovice';
    addLog('oVice モードに切り替え');
    fire('mode', Net.mode);
  }

  function parse(raw) {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return raw;
  }

  // oVice からのメッセージなら true を返す
  function handleOvice(ev) {
    if (ev.source === window) return false;
    const d = parse(ev.data);
    if (!d || typeof d.type !== 'string' || !d.type.startsWith('ovice_')) return false;
    switch (d.type) {
      case 'ovice_confirmation':
        addLog('ovice_confirmation');
        postToOvice('ovice_ready_confirmed');
        break;
      case 'ovice_participants': {
        const list = Array.isArray(d.payload) ? d.payload : [];
        Net.participants = list.filter(Boolean).map(normalize).filter(p => p.id);
        const self = Net.participants.find(p => p.isSelf);
        const keys = list[0] ? Object.keys(list[0]).filter(k => k !== 'email').join(',') : '-';
        addLog(`ovice_participants: ${Net.participants.length}人 / 自分=${self ? self.name || '(名前なし)' : 'なし'} / 項目: ${keys}`);
        if (self) setSelf(self);
        fire('participants', Net.participants);
        break;
      }
      case 'ovice_participant_subscribed':
      case 'ovice_participant_unsubscribed':
      case 'ovice_participant_joined':
      case 'ovice_participant_left': {
        const p = normalize(d.payload);
        addLog(`${d.type.replace('ovice_participant_', 'participant_')}: ${p.name || '(名前なし)'} isSelf=${p.isSelf ? 'true' : p.selfUnknown ? '未指定' : 'false'}`);
        // これらのイベントは「この画面を開いている本人」についての通知なので、isSelf が無くても自分とみなす
        if (p.isSelf || (p.selfUnknown && !selfConfirmed)) setSelf(p);
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
      default:
        addLog(d.type);
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
    addLog(inIframe ? 'oVice の応答がないためローカルモードで開始' : 'ローカルモードで開始');
    fire('self', Net.self);
    fire('mode', Net.mode);
  }

  function connect() {
    if (!inIframe || qs.get('local') === '1') {
      startLocal();
      return Promise.resolve(Net.mode);
    }
    addLog('oVice に接続中…');
    return new Promise(resolve => {
      let alive = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (alive) {
          switchToOvice();
          // 自分の ID がまだ取れていなくても、乱数 ID で対戦はできるようにする（取れ次第置き換わる）
          if (!Net.self.pid) {
            Net.self = { pid: 'r' + randomId(), name: 'ゲスト', avatarUrl: '' };
            addLog('自分の情報が未取得のため仮の ID で開始');
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
        if (done) switchToOvice();
        else if (selfConfirmed) finish();
      });
      // 自分の情報が取れるまで定期的に問い合わせる（最大 2 分）
      postToOvice('ovice_get_participants');
      let tries = 0;
      const retry = setInterval(() => {
        if (selfConfirmed || ++tries > 60) return clearInterval(retry);
        postToOvice('ovice_get_participants');
      }, 2000);
      setTimeout(finish, 3000);
    });
  }

  return Net;
})();
