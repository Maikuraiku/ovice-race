// ステージのしかけ（ギミック）と、拾うと効果のあるアイテム
//  ・位置が時刻（W.clock）だけで決まるもの（ブランコ・観覧車・レーザー…）は、協力プレイでも全員の画面で揃う
//  ・乗ると崩れる足場・台車・落ちてくるファイル・ハンコブロックは、各自の画面で自分の動きに反応する
//  ・アイテムは各自 1 回ずつ取れる（取り合いにならない）
const Gimmicks = (() => {
  const TILE = 40, GROUND_Y = 12 * TILE, TAU = Math.PI * 2;
  const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const cyc = (t, p, off = 0) => ((((t + off) % p) + p) % p);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const ITEMS = {
    coffee: { icon: '☕', name: 'ブラックコーヒー', text: '10 秒間 足が速くなる', fx: { speed: 10 } },
    parasol: { icon: '☂️', name: '日傘', text: '15 秒間 ジャンプ長押しで ふわっと降りる', fx: { glide: 15 } },
    sneaker: { icon: '👟', name: '通勤スニーカー', text: '12 秒間 高く跳べる', fx: { hijump: 12 } },
    magnet: { icon: '🧲', name: 'クリップ磁石', text: '12 秒間 近くの賞与を引き寄せる', fx: { magnet: 12 } },
    helmet: { icon: '⛑️', name: '安全ヘルメット', text: '1 回だけ ダメージを防ぐ', fx: { shield: 1 } },
    maneki: { icon: '🐱', name: '招き猫', text: '15 秒間 賞与が 2 倍', fx: { mult: 15 } },
    board: { icon: '🛹', name: 'スケボー', text: '速く走れて、ぶつかった敵を 1 回はね飛ばす', fx: { board: 1 } },
    light: { icon: '🔦', name: '懐中電灯', text: '暗いフロアが よく見える', fx: { light: 1 } },
    lottery: { icon: '🎫', name: '年末ジャンボ宝くじ', text: '当たれば賞与がどっさり' },
    clock: { icon: '⏰', name: '目覚まし時計', text: '定時まで +15 秒' },
    card: { icon: '📛', name: '社員証', text: 'セキュリティゲートを通れる', fx: { card: 1 } },
    jelly: { icon: '🧃', name: 'エナジーゼリー', text: '15 秒間 空中でもう 1 回跳べる', fx: { djump: 15 } },
  };
  const TIMED = [['speed', '☕'], ['hijump', '👟'], ['magnet', '🧲'], ['mult', '🐱'], ['djump', '🧃'], ['glide', '☂️']];

  // ---------- 登録用 ----------
  function plat(W, g, x, y, w, o) {
    const p = Object.assign({ x, y, w, dx: 0, dy: 0, off: false, g }, o);
    W.gplats.push(p);
    return p;
  }
  function solid(W, x, y, w, h, o) {
    const s = Object.assign({ x, y, w, h, on: true }, o);
    W.gsolids.push(s);
    return s;
  }
  function zone(W, kind, x, y, w, h, o) {
    const z = Object.assign({ kind, x, y, w, h, on: true }, o);
    W.gzones.push(z);
    return z;
  }
  function haz(W, kind, o) {
    const h = Object.assign({ kind, x: 0, y: 0, w: 0, h: 0, on: true }, o);
    W.ghaz.push(h);
    return h;
  }
  function setPos(p, x, y) {
    p.dx = x - p.x;
    p.dy = y - p.y;
    p.x = x;
    p.y = y;
  }
  function solidTile(W, c, r) {
    if (c < 0 || c >= W.w || r < 0 || r >= 14) return false;
    const t = W.tiles[r * W.w + c];
    return t !== 0 && t !== 7 && t !== 8;
  }

  // ---------- 種類ごとの定義 ----------
  //  init(g, W) 登録 / update(g, W, dt, me) 動かす / touch(g, W, me, api) 自分との接触 / draw(R, g, W, t, me) 描く
  //  layer: 'back'（地形の後ろ） / 'front'（既定） / 'over'（人の手前）
  const DEF = {};

  DEF.item = {
    init(g, W) {
      g.x = g.c * TILE + 20;
      g.y = g.r * TILE + 20;
      g.taken = false;
      W.gitems.push(g);
    },
    draw(R, g, W, t) {
      if (g.taken) return;
      const ctx = R.ctx, it = ITEMS[g.kind];
      const y = g.y + Math.sin(t * 3 + g.c) * 4;
      const glow = ctx.createRadialGradient(g.x, y, 4, g.x, y, 32);
      glow.addColorStop(0, 'rgba(255,250,190,0.75)');
      glow.addColorStop(1, 'rgba(255,250,190,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(g.x - 32, y - 32, 64, 64);
      ctx.beginPath();
      ctx.arc(g.x, y, 17, 0, TAU);
      ctx.fillStyle = '#fffdf5';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#f08a24';
      ctx.stroke();
      R.emoji(it.icon, g.x, y + 1, 20);
    },
  };

  // 研修用トランポリン：乗ると大きく跳ねる（ジャンプ長押しでさらに高く）
  DEF.spring = {
    init(g, W) {
      const r = g.r == null ? 11 : g.r;
      g.p = plat(W, g, g.c * TILE + 2, (r + 1) * TILE - 16, 36, { spring: true });
      g.squash = 0;
    },
    update(g, W, dt) { if (g.squash > 0) g.squash -= dt; },
    // 歩いて乗っても跳ねる
    touch(g, W, me, api) {
      const p = g.p, feet = me.y + me.h;
      if (!me.onGround || me.vy < 0 || feet < p.y - 1 || feet > p.y + 18 || me.x + me.w < p.x + 6 || me.x > p.x + p.w - 6) return;
      me.y = p.y - me.h;
      bounce(me, p, api);
    },
    draw(R, g) {
      const ctx = R.ctx, p = g.p, base = p.y + 16, s = g.squash > 0 ? 5 : 0, top = p.y + s;
      ctx.fillStyle = '#4b5361';
      ctx.fillRect(p.x, base - 4, p.w, 4);
      ctx.strokeStyle = '#a7b0bb';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const yy = base - 4 - ((base - 4 - top - 6) * i) / 5;
        const xx = p.x + (i % 2 ? p.w - 7 : 7);
        if (i) ctx.lineTo(xx, yy);
        else ctx.moveTo(xx, yy);
      }
      ctx.stroke();
      R.rrect(p.x - 3, top, p.w + 6, 7, 3);
      ctx.fillStyle = '#e53935';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(p.x + 2, top + 1, p.w - 4, 2);
    },
  };

  // ベルトコンベア（タイルは固いブロック。上に乗ると流される）
  DEF.conveyor = {
    init(g, W) { zone(W, 'convey', g.c * TILE, g.r * TILE, g.n * TILE, 4, { vx: g.dir * 115 }); },
    draw(R, g, W, t) {
      const ctx = R.ctx, x = g.c * TILE, y = g.r * TILE, w = g.n * TILE;
      R.rrect(x, y, w, TILE, 14);
      ctx.fillStyle = '#3d4350';
      ctx.fill();
      ctx.fillStyle = '#20242c';
      ctx.fillRect(x + 6, y + 3, w - 12, 9);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 6, y + 3, w - 12, 9);
      ctx.clip();
      ctx.strokeStyle = '#ffca28';
      ctx.lineWidth = 2;
      const off = (((t * 115 * g.dir) % 20) + 20) % 20;
      for (let xx = x - 20 + off; xx < x + w + 20; xx += 20) {
        ctx.beginPath();
        ctx.moveTo(xx, y + 4);
        ctx.lineTo(xx + 5 * g.dir, y + 7.5);
        ctx.lineTo(xx, y + 11);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#9aa3ad';
      for (let xx = x + 14; xx < x + w - 6; xx += 24) {
        ctx.beginPath();
        ctx.arc(xx, y + 26, 7, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#2b2f38';
      for (let xx = x + 14; xx < x + w - 6; xx += 24) ctx.fillRect(xx - 1.5, y + 24.5, 3, 3);
    },
  };

  // 運搬台車：乗ると終点までレールを進み、降りてしばらくすると戻ってくる
  DEF.cart = {
    init(g, W) {
      const r = g.r == null ? 11 : g.r;
      g.x0 = g.c * TILE;
      g.x1 = g.to * TILE;
      g.p = plat(W, g, g.x0, r * TILE + 10, 80);
      g.wait = 0;
    },
    update(g, W, dt, me) {
      const p = g.p, on = me && me.onLift === p;
      let nx = p.x;
      if (on) {
        nx = Math.min(g.x1, p.x + 160 * dt);
        g.wait = 1.8;
      } else if (g.wait > 0) g.wait -= dt;
      else nx = Math.max(g.x0, p.x - 100 * dt);
      setPos(p, nx, p.y);
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, p = g.p, y = p.y;
      ctx.strokeStyle = '#6d5a48';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(g.x0 + 6, y + 24);
      ctx.lineTo(g.x1 + 74, y + 24);
      ctx.stroke();
      ctx.fillStyle = '#4a3b2e';
      for (let xx = g.x0 + 10; xx < g.x1 + 74; xx += 24) ctx.fillRect(xx, y + 22, 3, 8);
      ctx.fillStyle = '#c8873f';
      ctx.fillRect(p.x, y, p.w, 10);
      ctx.fillStyle = '#9a6227';
      ctx.fillRect(p.x, y + 8, p.w, 4);
      ctx.strokeStyle = '#5b6373';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x + 4, y);
      ctx.lineTo(p.x - 2, y - 26);
      ctx.lineTo(p.x + 10, y - 26);
      ctx.stroke();
      ctx.fillStyle = '#2f343d';
      for (const wx of [p.x + 16, p.x + 64]) {
        ctx.beginPath();
        ctx.arc(wx, y + 17, 7, 0, TAU);
        ctx.fill();
      }
      R.text('台車', p.x + 44, y + 5, 9, '#fff', 'rgba(0,0,0,0.35)');
    },
  };

  // シャボン玉：機械から次々と生まれて昇っていく。上に乗れる
  DEF.bubble = {
    init(g, W) {
      g.r0 = g.r0 || 11;
      g.top = g.top || 2;
      g.n = g.n || 4;
      g.period = g.period || 2.4;
      g.speed = g.speed || 70;
      g.ps = [];
      for (let i = 0; i < g.n; i++) g.ps.push(plat(W, g, 0, 0, 60, { off: true, age: 0 }));
      DEF.bubble.update(g, W);
    },
    update(g, W) {
      const L = g.n * g.period;
      g.ps.forEach((p, i) => {
        const age = cyc(W.clock, L, i * g.period);
        const cy = (g.r0 + 1) * TILE - 40 - age * g.speed;
        const x = g.c * TILE + 20 - 30 + Math.sin(age * 1.7 + i) * 10;
        const y = cy - 26;
        const wasOff = p.off;
        p.off = age < 0.4 || y < g.top * TILE;
        p.age = age;
        if (wasOff || Math.abs(y - p.y) > 20) { p.x = x; p.y = y; p.dx = 0; p.dy = 0; }
        else setPos(p, x, y);
      });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, bx = g.c * TILE + 20, base = (g.r0 + 1) * TILE;
      // 機械
      R.rrect(bx - 26, base - 30, 52, 30, 6);
      ctx.fillStyle = '#7fb3d5';
      ctx.fill();
      ctx.strokeStyle = '#3d6f91';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, base - 32, 10, 0, TAU);
      ctx.strokeStyle = '#ff7eb6';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (const p of g.ps) {
        if (p.y < g.top * TILE - 30) continue;
        const grow = Math.min(1, p.age / 0.4);
        const cx = p.x + 30, cy = p.y + 28, rr = 28 * grow;
        if (rr < 2) continue;
        const pop = p.off && p.age >= 0.4;
        ctx.globalAlpha = pop ? 0.25 : 0.9;
        const gr = ctx.createRadialGradient(cx - 8, cy - 10, 2, cx, cy, rr);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)');
        gr.addColorStop(0.5, 'rgba(190,230,255,0.25)');
        gr.addColorStop(0.85, 'rgba(255,180,230,0.35)');
        gr.addColorStop(1, 'rgba(160,220,255,0.75)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },
  };

  // 信号と車：赤信号のあいだ、横断歩道を車が横切る
  DEF.traffic = {
    init(g, W) {
      g.x0 = g.c * TILE;
      g.x1 = (g.c + g.n) * TILE;
      g.period = 7.5;
      g.car = haz(W, 'car', { on: false, y: GROUND_Y - 42, h: 40 });
      g.colors = ['#e53935', '#1e88e5', '#fdd835'];
    },
    update(g, W) {
      const k = cyc(W.clock, g.period, g.off || 0);
      g.light = k < 4 ? 'green' : k < 5 ? 'yellow' : 'red';
      g.carX = null;
      for (let i = 0; i < 2; i++) {
        const s = 5.25 + i * 1.05, p = (k - s) / 0.75;
        if (p >= 0 && p <= 1) { g.carX = g.x0 - 110 + (g.x1 - g.x0 + 110) * p; g.carI = i; }
      }
      const h = g.car;
      if (g.carX == null) { h.on = false; return; }
      const a = Math.max(g.x0, g.carX), b = Math.min(g.x1, g.carX + 110);
      h.on = b > a;
      h.x = a;
      h.w = Math.max(0, b - a);
    },
    layer: 'front',
    draw(R, g, W, t) {
      const ctx = R.ctx;
      // 横断歩道
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let x = g.x0 + 4; x < g.x1 - 4; x += 20) ctx.fillRect(x, GROUND_Y + 2, 12, 12);
      // 歩行者用信号
      const px = g.x0 - 18;
      ctx.fillStyle = '#4b4f58';
      ctx.fillRect(px - 3, GROUND_Y - 150, 6, 150);
      R.rrect(px - 16, GROUND_Y - 196, 32, 52, 5);
      ctx.fillStyle = '#2b2e35';
      ctx.fill();
      const red = g.light !== 'green', blink = g.light === 'yellow' && Math.sin(t * 20) < 0;
      ctx.fillStyle = red ? '#ff4d4d' : '#4a2222';
      ctx.beginPath();
      ctx.arc(px, GROUND_Y - 182, 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = !red || (g.light === 'yellow' && !blink) ? '#4dff88' : '#1d3d2a';
      ctx.beginPath();
      ctx.arc(px, GROUND_Y - 158, 9, 0, TAU);
      ctx.fill();
      if (g.light === 'yellow') R.text('!', px, GROUND_Y - 210, 16, '#ffeb3b');
      // 車（横断歩道の範囲だけに見える）
      if (g.carX != null) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x0, GROUND_Y - 80, g.x1 - g.x0, 100);
        ctx.clip();
        const x = g.carX, y = GROUND_Y - 42;
        R.rrect(x, y + 10, 110, 26, 8);
        ctx.fillStyle = g.colors[(g.carI + Math.floor(W.clock / g.period)) % 3];
        ctx.fill();
        R.rrect(x + 22, y - 6, 62, 22, 8);
        ctx.fill();
        ctx.fillStyle = '#cfe8ff';
        ctx.fillRect(x + 28, y - 1, 22, 13);
        ctx.fillRect(x + 56, y - 1, 22, 13);
        ctx.fillStyle = '#222';
        for (const wx of [x + 24, x + 86]) {
          ctx.beginPath();
          ctx.arc(wx, y + 36, 9, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#fff59d';
        ctx.fillRect(x + 104, y + 16, 6, 6);
        ctx.restore();
      }
    },
  };

  // 扇風機：前にいると風で押し流される
  DEF.fan = {
    init(g, W) {
      g.dir = g.dir || 1;
      const len = (g.len || 6) * TILE, r = g.r == null ? 11 : g.r;
      g.fy = r * TILE + 8;
      g.bottom = (r + 1) * TILE;
      const x = g.dir > 0 ? g.c * TILE + 40 : g.c * TILE - len;
      g.z = zone(W, 'wind', x, (r - 2) * TILE, len, 3 * TILE + 20, { vx: g.dir * (g.power || 170) });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, cx = g.c * TILE + 20, cy = g.fy;
      const z = g.z;
      // 風の筋
      ctx.strokeStyle = 'rgba(200,235,255,0.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const ph = ((t * 1.6 + i * 0.37) % 1);
        const len = 40;
        const x = g.dir > 0 ? z.x + ph * (z.w - len) : z.x + z.w - len - ph * (z.w - len);
        const y = z.y + 12 + ((i * 37) % (z.h - 24));
        ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7a8594';
      ctx.fillRect(cx - 3, cy, 6, g.bottom - cy);
      ctx.fillRect(cx - 14, g.bottom - 5, 28, 5);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(0.45, 1);
      ctx.fillStyle = 'rgba(160,220,255,0.55)';
      for (let i = 0; i < 3; i++) {
        const a = t * 25 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 9, Math.sin(a) * 9, 11, 5, a, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = '#cfd8dc';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, TAU);
      ctx.stroke();
      ctx.restore();
    },
  };

  // オーバーヒート床：赤く光っているあいだに乗るとやけど
  DEF.hotfloor = {
    init(g, W) {
      g.period = g.period || 5;
      g.h = haz(W, 'burn', { x: g.c * TILE, y: g.r * TILE - 4, w: g.n * TILE, h: 6, on: false });
    },
    update(g, W) {
      const k = cyc(W.clock, g.period, g.off || 0);
      g.state = k < g.period - 2.4 ? 0 : k < g.period - 1.4 ? 1 : 2;
      g.k = k;
      g.h.on = g.state === 2;
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, x = g.c * TILE, y = g.r * TILE, w = g.n * TILE;
      if (g.state === 0) {
        ctx.fillStyle = 'rgba(255,120,60,0.18)';
        ctx.fillRect(x, y, w, 8);
        return;
      }
      const hot = g.state === 2;
      const a = hot ? 0.75 : 0.35 + 0.3 * Math.abs(Math.sin(t * 10));
      const gr = ctx.createLinearGradient(0, y - 30, 0, y + 12);
      gr.addColorStop(0, 'rgba(255,80,20,0)');
      gr.addColorStop(1, hot ? `rgba(255,60,20,${a})` : `rgba(255,170,40,${a})`);
      ctx.fillStyle = gr;
      ctx.fillRect(x, y - 30, w, 42);
      if (hot) {
        ctx.strokeStyle = 'rgba(255,220,180,0.6)';
        ctx.lineWidth = 2;
        for (let xx = x + 10; xx < x + w; xx += 26) {
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const yy = y - 4 - k * 5 - ((t * 40) % 5);
            const xo = xx + Math.sin(t * 8 + k + xx) * 3;
            if (k) ctx.lineTo(xo, yy);
            else ctx.moveTo(xo, yy);
          }
          ctx.stroke();
        }
      }
    },
  };

  // 排熱ダクトの上昇気流：中に入るとふわっと持ち上げられる
  DEF.updraft = {
    init(g, W) {
      const top = (g.top || 2) * TILE, n = g.n || 2;
      g.z = zone(W, 'up', g.c * TILE, top, n * TILE, GROUND_Y - top, { power: 2600 });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, z = g.z;
      const gr = ctx.createLinearGradient(0, z.y, 0, z.y + z.h);
      gr.addColorStop(0, 'rgba(255,140,90,0)');
      gr.addColorStop(1, 'rgba(255,140,90,0.22)');
      ctx.fillStyle = gr;
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = 'rgba(255,230,210,0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const ph = (t * 0.9 + i / 6) % 1;
        const x = z.x + 8 + ((i * 29) % (z.w - 16));
        const y = z.y + z.h - ph * z.h;
        ctx.globalAlpha = Math.sin(ph * Math.PI);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 6, y - 15, x, y - 30);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#3a3f48';
      ctx.fillRect(z.x, GROUND_Y - 10, z.w, 10);
      ctx.fillStyle = '#1e2228';
      for (let x = z.x + 5; x < z.x + z.w - 4; x += 9) ctx.fillRect(x, GROUND_Y - 8, 4, 7);
    },
  };

  // 屋上プール：水の中では何度でも泳いで浮き上がれる
  DEF.pool = {
    layer: 'over',
    init(g, W) {
      const y = g.r * TILE;
      g.z = zone(W, 'water', g.c * TILE, y + 6, g.n * TILE, GROUND_Y - y - 6);
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, z = g.z;
      const gr = ctx.createLinearGradient(0, z.y, 0, z.y + z.h);
      gr.addColorStop(0, 'rgba(90,200,255,0.5)');
      gr.addColorStop(1, 'rgba(30,110,200,0.62)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(z.x, z.y + z.h);
      for (let x = z.x; x <= z.x + z.w; x += 10) ctx.lineTo(x, z.y + Math.sin(t * 3 + x * 0.06) * 3);
      ctx.lineTo(z.x + z.w, z.y + z.h);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = z.x; x <= z.x + z.w; x += 10) {
        const y = z.y + Math.sin(t * 3 + x * 0.06) * 3;
        if (x === z.x) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 6; i++) {
        const x = z.x + ((i * 53 + t * 20) % z.w), y = z.y + 30 + ((i * 41) % Math.max(20, z.h - 40));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y + 4);
        ctx.stroke();
      }
    },
  };

  // 提灯ブランコ：揺れる提灯の上に乗れる
  DEF.lantern = {
    init(g, W) {
      g.len = g.len || 4;
      g.amp = g.amp || 0.7;
      g.speed = g.speed || 1.6;
      g.px = g.c * TILE + 20;
      g.py = g.r * TILE;
      g.p = plat(W, g, 0, 0, 56);
      DEF.lantern.update(g, W, 0, null, true);
    },
    update(g, W, dt, me, first) {
      const a = g.amp * Math.sin(W.clock * g.speed + (g.off || 0));
      g.cx = g.px + Math.sin(a) * g.len * TILE;
      g.cy = g.py + Math.cos(a) * g.len * TILE;
      if (first) { g.p.x = g.cx - 28; g.p.y = g.cy - 24; }
      else setPos(g.p, g.cx - 28, g.cy - 24);
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(g.px, g.py);
      ctx.lineTo(g.cx, g.cy - 24);
      ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(g.px - 8, g.py - 4, 16, 6);
      const glow = ctx.createRadialGradient(g.cx, g.cy, 6, g.cx, g.cy, 60);
      glow.addColorStop(0, 'rgba(255,200,120,0.45)');
      glow.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(g.cx - 60, g.cy - 60, 120, 120);
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.ellipse(g.cx, g.cy, 27, 22, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,20,20,0.6)';
      ctx.lineWidth = 1.5;
      for (const k of [-12, 0, 12]) {
        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy + k * 0.2, 27 * Math.cos((k / 30) * 1.2), 22, 0, -0.2, Math.PI + 0.2, true);
        ctx.stroke();
      }
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(g.cx - 18, g.cy - 25, 36, 6);
      ctx.fillRect(g.cx - 15, g.cy + 19, 30, 6);
      R.text('祭', g.cx, g.cy + 1, 18, '#fff3e0', 'rgba(80,0,0,0.6)');
    },
  };

  // 打ち上げ花火の筒：打ち上がる瞬間に筒の上にいると、空高く打ち上げられる
  DEF.firework = {
    init(g, W) {
      g.period = g.period || 3.4;
      g.x = g.c * TILE;
      g.top = 10 * TILE;
      g.k = 0;
    },
    update(g, W) { g.k = cyc(W.clock, g.period, g.off || 0); },
    touch(g, W, me, api) {
      if (g.k > 0.22 || !me.onGround) return;
      if (Math.abs(me.y + me.h - g.top) > 2 || me.x + me.w < g.x + 3 || me.x > g.x + TILE - 3) return;
      me.vy = -980;
      me.jumping = true;
      me.boost = true; // 長押ししなくても高く上がる
      me.onGround = false;
      me.onLift = null;
      me.coyote = 0;
      api.sfx('boom');
      api.popup(me.x + me.w / 2, me.y - 10, 'たまや〜！', { size: 18, color: '#ffcc80' });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, x = g.x, k = g.k;
      R.rrect(x + 2, g.top - 4, 36, 84, 6);
      ctx.fillStyle = '#b71c1c';
      ctx.fill();
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(x + 2, g.top + 10, 36, 6);
      ctx.fillRect(x + 2, g.top + 50, 36, 6);
      ctx.fillStyle = '#3e2723';
      ctx.beginPath();
      ctx.ellipse(x + 20, g.top - 3, 16, 5, 0, 0, TAU);
      ctx.fill();
      if (k > g.period - 0.9) {
        // 導火線の火花
        for (let i = 0; i < 5; i++) {
          const a = t * 30 + i * 1.3;
          ctx.fillStyle = i % 2 ? '#fff59d' : '#ffab40';
          ctx.fillRect(x + 20 + Math.cos(a) * 9, g.top - 10 + Math.sin(a) * 6, 3, 3);
        }
      }
      if (k < 1.05) {
        const y = g.top - k * 330;
        ctx.fillStyle = '#fff3e0';
        ctx.beginPath();
        ctx.arc(x + 20, y, 4, 0, TAU);
        ctx.fill();
      } else if (k < 2.3) {
        const p = (k - 1.05) / 1.25, cy = g.top - 346, rr = 20 + p * 90;
        const cols = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'];
        ctx.globalAlpha = 1 - p;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * TAU;
          ctx.fillStyle = cols[(i + g.c) % cols.length];
          ctx.beginPath();
          ctx.arc(x + 20 + Math.cos(a) * rr, cy + Math.sin(a) * rr + p * p * 30, 3.2, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    },
  };

  // 崩れる書類の山：乗ってしばらくすると崩れる（少したつと元に戻る）
  DEF.crumble = {
    init(g, W) {
      g.ps = [];
      for (let i = 0; i < g.n; i++) g.ps.push(plat(W, g, (g.c + i) * TILE, g.r * TILE, TILE, { st: 0, t: 0, fy: 0, fv: 0 }));
    },
    update(g, W, dt, me) {
      for (const p of g.ps) {
        if (p.st === 0) {
          if (me && me.onLift === p) { p.st = 1; p.t = 0.5; }
        } else if (p.st === 1) {
          p.t -= dt;
          if (p.t <= 0) { p.st = 2; p.t = 3.6; p.off = true; p.fy = 0; p.fv = 0; }
        } else {
          p.t -= dt;
          p.fv += 1800 * dt;
          p.fy += p.fv * dt;
          if (p.t <= 0) { p.st = 0; p.off = false; }
        }
      }
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      for (const p of g.ps) {
        let x = p.x, y = p.y;
        if (p.st === 1) x += Math.sin(t * 60) * 2;
        if (p.st === 2) {
          if (p.fy > 600) {
            if (p.t < 0.5) { ctx.globalAlpha = 0.4; }
            else continue;
          } else y += p.fy;
        }
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? '#f5f5f0' : '#e8e6dc';
          ctx.fillRect(x + 1 + (i % 2) * 2, y + i * 6, TILE - 4, 6);
        }
        ctx.fillStyle = '#c9c4b5';
        ctx.fillRect(x + 1, y + 24, TILE - 2, 10);
        ctx.fillStyle = '#9e9e9e';
        ctx.fillRect(x + 8, y + 26, TILE - 16, 2);
        ctx.fillRect(x + 8, y + 30, TILE - 20, 2);
        ctx.globalAlpha = 1;
      }
    },
  };

  // 落ちてくるファイル：真下を通ると落ちてきて、しばらくすると元の棚に戻る
  DEF.fallingfile = {
    init(g, W) {
      g.x = g.c * TILE;
      g.y0 = g.r * TILE;
      g.y = g.y0;
      g.st = 0;
      g.v = 0;
      let r = g.r + 1;
      while (r < 14 && !solidTile(W, g.c, r)) r++;
      g.yEnd = r * TILE - TILE;
      g.h = haz(W, 'file', { x: g.x + 3, y: g.y, w: 34, h: 40, on: false });
    },
    update(g, W, dt, me) {
      if (g.st === 0) {
        if (me && !me.dead && me.x + me.w > g.x - 34 && me.x < g.x + 74 && me.y > g.y) { g.st = 1; g.t = 0.3; }
      } else if (g.st === 1) {
        g.t -= dt;
        if (g.t <= 0) { g.st = 2; g.v = 0; }
      } else if (g.st === 2) {
        g.v += 2600 * dt;
        g.y = Math.min(g.yEnd, g.y + g.v * dt);
        if (g.y >= g.yEnd) { g.st = 3; g.t = 1.2; }
      } else if (g.st === 3) {
        g.t -= dt;
        if (g.t <= 0) g.st = 4;
      } else {
        g.y -= 110 * dt;
        if (g.y <= g.y0) { g.y = g.y0; g.st = 0; }
      }
      g.h.y = g.y;
      g.h.on = g.st === 2;
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      ctx.fillStyle = '#6d6a62';
      ctx.fillRect(g.x - 6, g.y0 - 4, TILE + 12, 4);
      ctx.strokeStyle = 'rgba(80,80,80,0.6)';
      ctx.lineWidth = 1.5;
      if (g.y > g.y0 + 2) {
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(g.x + 20, g.y0);
        ctx.lineTo(g.x + 20, g.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const x = g.x + (g.st === 1 ? Math.sin(t * 70) * 2 : 0), y = g.y;
      R.rrect(x + 2, y, 36, 40, 4);
      ctx.fillStyle = '#26418f';
      ctx.fill();
      ctx.fillStyle = '#e8eaf6';
      ctx.fillRect(x + 8, y + 6, 24, 14);
      R.text('重要', x + 20, y + 13, 10, '#c62828', 'rgba(255,255,255,0)');
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 9, y + 26, 7, 6);
      ctx.fillRect(x + 24, y + 26, 7, 6);
      ctx.fillStyle = '#111';
      const look = g.st >= 1 && g.st <= 2 ? 2 : 0;
      ctx.fillRect(x + 11, y + 27 + look, 3, 3);
      ctx.fillRect(x + 26, y + 27 + look, 3, 3);
      if (g.st === 3 && g.t > 0.9) {
        ctx.fillStyle = 'rgba(200,200,200,0.6)';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(x + 4 + i * 11, y + 40, 6 + (1.2 - g.t) * 20, 0, TAU);
          ctx.fill();
        }
      }
    },
  };

  // シュレッダー：上からガシャンと降りてくる
  DEF.shredder = {
    init(g, W) {
      g.x = g.c * TILE;
      g.yTop = g.r0 * TILE;
      g.yBot = g.r1 * TILE - 64;
      g.period = g.period || 3.2;
      g.h = haz(W, 'shred', { x: g.x + 4, y: g.yTop, w: 72, h: 60 });
      DEF.shredder.update(g, W);
    },
    update(g, W) {
      const k = cyc(W.clock, g.period, g.off || 0);
      let p;
      if (k < 0.3) p = (k / 0.3) ** 2;
      else if (k < 0.8) p = 1;
      else if (k < 2.2) p = 1 - (k - 0.8) / 1.4;
      else p = 0;
      g.y = g.yTop + (g.yBot - g.yTop) * p;
      g.h.y = g.y + 4;
      g.warn = k > g.period - 0.5;
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, x = g.x, y = g.y;
      ctx.fillStyle = '#5b6370';
      ctx.fillRect(x + 8, R.view.top, 6, y - R.view.top);
      ctx.fillRect(x + 66, R.view.top, 6, y - R.view.top);
      R.rrect(x, y, 80, 46, 6);
      ctx.fillStyle = g.warn ? '#ff7043' : '#cfd5dc';
      ctx.fill();
      ctx.strokeStyle = '#5b6370';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#263238';
      ctx.fillRect(x + 12, y + 12, 56, 6);
      R.text('シュレッダー', x + 40, y + 31, 10, '#37474f', 'rgba(255,255,255,0)');
      ctx.fillStyle = '#90a4ae';
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 4 + i * 9, y + 46);
        ctx.lineTo(x + 8.5 + i * 9, y + 62);
        ctx.lineTo(x + 13 + i * 9, y + 46);
        ctx.fill();
      }
      ctx.fillStyle = '#fafafa';
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 14 + i * 12, y + 46 + ((t * 60 + i * 7) % 10), 3, 8);
    },
  };

  // 突風：ときどき強い風が吹いて押し戻される（直前に吹き流しが揺れる）
  DEF.gust = {
    init(g, W) {
      g.period = g.period || 6;
      g.dir = g.dir || -1;
      g.z = zone(W, 'wind', g.c1 * TILE, -400, (g.c2 - g.c1) * TILE, 1400, { vx: g.dir * (g.power || 200), on: false });
    },
    update(g, W) {
      const k = cyc(W.clock, g.period, g.off || 0);
      g.k = k;
      g.z.on = k >= 1 && k < 3.2;
      g.warn = k >= 0.2 && k < 1;
    },
    layer: 'over',
    draw(R, g, W, t) {
      const ctx = R.ctx, z = g.z;
      // 吹き流し
      for (let c = g.c1 + 3; c < g.c2; c += 14) {
        const x = c * TILE + 20, y = GROUND_Y - 150;
        ctx.fillStyle = '#9e9e9e';
        ctx.fillRect(x - 2, y, 4, 150);
        const s = z.on ? 1 : g.warn ? 0.6 + Math.sin(t * 18) * 0.2 : 0.25;
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? '#fff' : '#ff5722';
          const w = 13 * s + 2, sag = (1 - s) * 7 * i;
          ctx.fillRect(x + g.dir * (i * w) - (g.dir < 0 ? w : 0), y + 2 + sag + Math.sin(t * 12 + i) * 2 * s, w, 12 - i * 2);
        }
      }
      if (!z.on && !g.warn) return;
      ctx.strokeStyle = z.on ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = z.on ? 2.5 : 1.5;
      const x0 = Math.max(z.x, R.camL - 50), x1 = Math.min(z.x + z.w, R.camR + 50);
      for (let i = 0; i < 14; i++) {
        const span = x1 - x0;
        if (span <= 0) break;
        const ph = (t * (z.on ? 2.4 : 1) + i * 0.173) % 1;
        const x = g.dir < 0 ? x1 - ph * span : x0 + ph * span;
        const y = R.view.top + 30 + ((i * 97) % 420);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - g.dir * (z.on ? 80 : 40), y + Math.sin(i) * 4);
        ctx.stroke();
      }
    },
  };

  // 観覧車ゴンドラ：回るゴンドラの屋根に乗れる
  DEF.wheel = {
    init(g, W) {
      g.cx = g.c * TILE + 20;
      g.cy = g.r * TILE + 20;
      g.R = (g.rad || 3) * TILE;
      g.n = g.n || 4;
      g.speed = g.speed || 0.45;
      g.ps = [];
      for (let i = 0; i < g.n; i++) g.ps.push(plat(W, g, 0, 0, 64));
      DEF.wheel.update(g, W, 0, null, true);
    },
    update(g, W, dt, me, first) {
      g.ps.forEach((p, i) => {
        const a = W.clock * g.speed + (i / g.n) * TAU;
        p.hx = g.cx + Math.cos(a) * g.R;
        p.hy = g.cy + Math.sin(a) * g.R;
        if (first) { p.x = p.hx - 32; p.y = p.hy + 4; }
        else setPos(p, p.hx - 32, p.hy + 4);
      });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      ctx.strokeStyle = '#8d99ae';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(g.cx - g.R * 0.6, GROUND_Y);
      ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(g.cx + g.R * 0.6, GROUND_Y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(141,153,174,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.R, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (const p of g.ps) {
        ctx.beginPath();
        ctx.moveTo(g.cx, g.cy);
        ctx.lineTo(p.hx, p.hy);
        ctx.stroke();
      }
      ctx.fillStyle = '#5c677d';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, 10, 0, TAU);
      ctx.fill();
      const cols = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc'];
      g.ps.forEach((p, i) => {
        ctx.fillStyle = '#455a64';
        ctx.fillRect(p.hx - 2, p.hy - 4, 4, 8);
        R.rrect(p.x + 4, p.y, 56, 38, 8);
        ctx.fillStyle = cols[i % cols.length];
        ctx.fill();
        ctx.fillStyle = 'rgba(220,240,255,0.85)';
        ctx.fillRect(p.x + 12, p.y + 9, 16, 14);
        ctx.fillRect(p.x + 36, p.y + 9, 16, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(p.x + 4, p.y, 56, 5);
      });
    },
  };

  // 銀杏並木：銀杏の実が落ちてくる。当たると くさくて少し動けない
  DEF.ginkgo = {
    layer: 'back',
    init(g, W) {
      g.x = g.c * TILE + 20;
      g.y0 = 5 * TILE;
      g.nuts = [];
      for (let i = 0; i < 3; i++) g.nuts.push(haz(W, 'ginkgo', { circle: true, r: 9, on: false, stun: 0.5, text: '銀杏が直撃！くさい…' }));
    },
    update(g, W) {
      g.nuts.forEach((h, i) => {
        const k = cyc(W.clock, 2.8, i * 0.93 + g.c * 0.37);
        h.cx = g.x - 46 + i * 46;
        h.cy = Math.min(GROUND_Y - 6, g.y0 + 1100 * k * k);
        h.k = k;
        h.on = h.cy < GROUND_Y - 6;
      });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(g.x - 8, GROUND_Y - 260, 16, 260);
      for (const [dx, dy, r] of [[0, -300, 80], [-60, -260, 60], [60, -262, 62], [-30, -340, 56], [34, -336, 58]]) {
        ctx.fillStyle = '#f9c62b';
        ctx.beginPath();
        ctx.arc(g.x + dx, GROUND_Y + dy, r, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(230,160,20,0.5)';
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(g.x - 70 + ((i * 47) % 140), GROUND_Y - 330 + ((i * 31) % 110), 16, 0, TAU);
        ctx.fill();
      }
    },
    drawFront(R, g, W, t) {
      const ctx = R.ctx;
      for (const h of g.nuts) {
        if (h.on) {
          ctx.fillStyle = '#f2d36b';
          ctx.beginPath();
          ctx.arc(h.cx, h.cy, 9, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = '#b8902a';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (h.k < 1.2) {
          ctx.fillStyle = 'rgba(210,180,80,0.7)';
          ctx.beginPath();
          ctx.ellipse(h.cx, GROUND_Y - 2, 12, 4, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(150,170,60,0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(h.cx - 6, GROUND_Y - 10);
          ctx.quadraticCurveTo(h.cx - 2, GROUND_Y - 22, h.cx - 8, GROUND_Y - 30);
          ctx.moveTo(h.cx + 6, GROUND_Y - 10);
          ctx.quadraticCurveTo(h.cx + 10, GROUND_Y - 22, h.cx + 4, GROUND_Y - 30);
          ctx.stroke();
        }
      }
    },
  };

  // 節電で点いたり消えたりする照明の足場
  DEF.blink = {
    init(g, W) {
      g.period = g.period || 3.6;
      g.p = plat(W, g, g.c * TILE, g.r * TILE, g.n * TILE);
      DEF.blink.update(g, W);
    },
    update(g, W) {
      const k = cyc(W.clock, g.period, g.off || 0), onT = g.period * 0.62;
      g.p.off = k >= onT;
      g.warn = !g.p.off && k > onT - 0.6;
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, p = g.p;
      const flick = g.warn && Math.sin(t * 40) < 0;
      if (!p.off && !flick) {
        const glow = ctx.createLinearGradient(0, p.y - 26, 0, p.y + 40);
        glow.addColorStop(0, 'rgba(255,255,220,0)');
        glow.addColorStop(0.4, 'rgba(255,255,220,0.35)');
        glow.addColorStop(1, 'rgba(255,255,220,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(p.x - 10, p.y - 26, p.w + 20, 66);
        R.rrect(p.x, p.y, p.w, 12, 6);
        ctx.fillStyle = '#fffde7';
        ctx.fill();
        ctx.strokeStyle = '#cfd8dc';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        R.rrect(p.x, p.y, p.w, 12, 6);
        ctx.fillStyle = 'rgba(80,90,110,0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,170,190,0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    light(g) { return g.p.off ? null : { x: g.p.x + g.p.w / 2, y: g.p.y + 6, r: 70 + g.p.w * 0.4 }; },
  };

  // ブレーカー切替ブロック：赤と青が交互に実体化する
  DEF.breaker = {
    init(g, W) {
      g.period = g.period || 3;
      g.s = solid(W, g.c * TILE, g.r * TILE, g.n * TILE, TILE, { on: false });
      DEF.breaker.update(g, W);
    },
    update(g, W) {
      const ph = Math.floor((W.clock + (g.off || 0)) / g.period);
      g.s.on = (ph % 2 === 0) === (g.grp === 0);
      g.warn = cyc(W.clock, g.period, g.off || 0) > g.period - 0.6;
    },
    draw(R, g, W, t) { drawToggle(R, g.s, g.grp === 0 ? ['#ef5350', '#b71c1c'] : ['#42a5f5', '#0d47a1'], g.s.on, g.warn && Math.sin(t * 30) < 0, '⚡'); },
  };
  function drawToggle(R, s, [c1, c2], on, blink, mark) {
    const ctx = R.ctx;
    for (let x = s.x; x < s.x + s.w - 1; x += TILE) {
      if (on && !blink) {
        R.rrect(x + 1, s.y + 1, TILE - 2, TILE - 2, 5);
        ctx.fillStyle = c1;
        ctx.fill();
        ctx.strokeStyle = c2;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(x + 5, s.y + 4, TILE - 10, 4);
        R.text(mark, x + TILE / 2, s.y + TILE / 2 + 2, 16, '#fff', c2);
      } else {
        R.rrect(x + 3, s.y + 3, TILE - 6, TILE - 6, 5);
        ctx.strokeStyle = c1;
        ctx.globalAlpha = blink ? 0.8 : 0.45;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  }

  // 内線転送ドア：入ると出口のドアへ移動する（一方通行）
  DEF.portal = {
    init(g, W) {
      const r = g.r == null ? 11 : g.r, tr = g.to[1] == null ? 11 : g.to[1];
      g.x = g.c * TILE;
      g.y = (r - 1) * TILE;
      g.tx = g.to[0] * TILE;
      g.ty = (tr + 1) * TILE;
    },
    touch(g, W, me, api) {
      if (me.portalCool > 0 || !ov(me, { x: g.x + 10, y: g.y + 10, w: 20, h: 70 })) return;
      me.x = g.tx + 20 - me.w / 2;
      me.y = g.ty - me.h;
      me.vy = 0;
      me.onLift = null;
      me.portalCool = 0.9;
      api.sfx('warp');
      api.popup(me.x + me.w / 2, me.y - 12, '内線転送！', { size: 16, color: '#80deea' });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      const door = (x, y, col, label) => {
        R.rrect(x + 2, y, 36, 80, 5);
        ctx.fillStyle = '#263238';
        ctx.fill();
        const gr = ctx.createLinearGradient(0, y + 6, 0, y + 74);
        gr.addColorStop(0, col);
        gr.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = gr;
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 4 + x);
        ctx.fillRect(x + 7, y + 6, 26, 68);
        ctx.globalAlpha = 1;
        R.text(label, x + 20, y - 8, 11, '#fff', 'rgba(0,0,0,0.6)');
      };
      door(g.x, g.y, '#4dd0e1', '転送');
      door(g.tx, g.ty - 80, '#ffb74d', '着信');
    },
    light(g) { return { x: g.x + 20, y: g.y + 40, r: 80 }; },
  };

  // 凍った歩道：よく滑る
  DEF.ice = {
    init(g, W) { zone(W, 'ice', g.c * TILE, (g.r == null ? 12 : g.r) * TILE, g.n * TILE, 4); },
    draw(R, g, W, t) {
      const ctx = R.ctx, x = g.c * TILE, y = (g.r == null ? 12 : g.r) * TILE, w = g.n * TILE;
      ctx.fillStyle = 'rgba(200,235,255,0.75)';
      ctx.fillRect(x, y - 2, w, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let xx = x + 6; xx < x + w; xx += 34) ctx.fillRect(xx, y, 14, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 4; i++) {
        const xx = x + ((i * 71 + Math.floor(t * 2) * 13) % w);
        if (Math.sin(t * 6 + i) > 0.6) ctx.fillRect(xx, y - 4, 2, 2);
      }
    },
  };

  // 転がる雪玉：右から転がってくる。上から踏めば跳ね返れる
  DEF.snowball = {
    init(g, W) {
      g.x0 = g.from * TILE;
      g.x1 = g.to * TILE;
      g.y = (g.r == null ? 12 : g.r) * TILE;
      g.period = g.period || 4;
      g.speed = g.speed || 150;
      g.k = Math.ceil((g.x0 - g.x1) / g.speed / g.period) + 1;
      g.balls = [];
      for (let i = 0; i < g.k; i++) g.balls.push(haz(W, 'snow', { circle: true, r: 14, on: false, stomp: true }));
    },
    update(g, W) {
      const L = g.k * g.period;
      g.balls.forEach((h, i) => {
        const age = cyc(W.clock, L, i * g.period + (g.off || 0));
        const r = 14 + Math.min(14, age * 4);
        h.cx = g.x0 - age * g.speed;
        h.r = r;
        h.cy = g.y - r;
        h.rot = -(age * g.speed) / r;
        h.on = h.cx > g.x1;
      });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      for (const h of g.balls) {
        if (!h.on) continue;
        ctx.fillStyle = '#f5f9ff';
        ctx.beginPath();
        ctx.arc(h.cx, h.cy, h.r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#b0c4de';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(150,175,210,0.7)';
        ctx.beginPath();
        ctx.arc(h.cx, h.cy, h.r * 0.6, h.rot, h.rot + 2);
        ctx.stroke();
      }
    },
  };

  // 閉店シャッター：一定の間隔で下りてくる
  DEF.shutter = {
    init(g, W) {
      g.x = g.c * TILE + 4;
      g.top = (g.r0 || 2) * TILE;
      g.full = GROUND_Y - g.top;
      g.period = g.period || 5;
      g.s = solid(W, g.x, g.top, 32, 0, { on: false });
    },
    update(g, W, dt, me) {
      const P = g.period, k = cyc(W.clock, P, g.off || 0);
      let f;
      if (k < P * 0.45) f = 0;
      else if (k < P * 0.57) f = (k - P * 0.45) / (P * 0.12);
      else if (k < P * 0.88) f = 1;
      else f = 1 - (k - P * 0.88) / (P * 0.12);
      g.f = f;
      g.s.h = g.full * f;
      g.s.on = f > 0.02;
      // 閉まってくるシャッターに挟まれないよう、近いほうへ押し出す
      if (me && !me.dead && g.s.on && ov(me, g.s)) {
        if (me.x + me.w / 2 < g.x + 16) { me.x = g.x - me.w - 0.5; if (me.vx > 0) me.vx = 0; }
        else { me.x = g.x + 32.5; if (me.vx < 0) me.vx = 0; }
      }
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, x = g.x, h = g.s.h;
      ctx.fillStyle = '#546e7a';
      ctx.fillRect(x - 6, g.top - 22, 44, 22);
      ctx.fillStyle = '#37474f';
      ctx.fillRect(x - 6, g.top - 4, 44, 4);
      ctx.fillStyle = '#78909c';
      ctx.fillRect(x - 2, g.top, 3, g.full);
      ctx.fillRect(x + 31, g.top, 3, g.full);
      if (h > 1) {
        ctx.fillStyle = '#b0bec5';
        ctx.fillRect(x, g.top, 32, h);
        ctx.fillStyle = '#90a4ae';
        for (let y = g.top + 6; y < g.top + h; y += 8) ctx.fillRect(x, y, 32, 2);
        ctx.fillStyle = '#455a64';
        ctx.fillRect(x + 8, g.top + h - 6, 16, 4);
        if (h > 160) {
          ctx.save();
          ctx.translate(x + 16, g.top + h - 90);
          R.text('本', 0, -22, 12, '#c62828', 'rgba(255,255,255,0.6)');
          R.text('日', 0, -8, 12, '#c62828', 'rgba(255,255,255,0.6)');
          R.text('閉', 0, 6, 12, '#c62828', 'rgba(255,255,255,0.6)');
          R.text('店', 0, 20, 12, '#c62828', 'rgba(255,255,255,0.6)');
          ctx.restore();
        }
      }
    },
  };

  // 株価チャートの足場：ローソク足が上下に波打つ
  DEF.chart = {
    init(g, W) {
      g.n = g.n || 4;
      g.gap = g.gap || 3;
      g.amp = g.amp || 2;
      g.speed = g.speed || 1.2;
      g.ps = [];
      for (let i = 0; i < g.n; i++) g.ps.push(plat(W, g, (g.c + i * g.gap) * TILE, g.r * TILE, 80));
      DEF.chart.update(g, W, 0, null, true);
    },
    update(g, W, dt, me, first) {
      g.ps.forEach((p, i) => {
        const a = W.clock * g.speed + i * 1.1;
        const y = g.r * TILE + Math.sin(a) * g.amp * TILE;
        p.up = Math.cos(a) < 0;
        if (first) p.y = y;
        else setPos(p, p.x, y);
      });
    },
    draw(R, g, W, t) {
      const ctx = R.ctx;
      ctx.strokeStyle = 'rgba(255,235,59,0.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      g.ps.forEach((p, i) => {
        if (i) ctx.lineTo(p.x + 40, p.y + 8);
        else ctx.moveTo(p.x + 40, p.y + 8);
      });
      ctx.stroke();
      for (const p of g.ps) {
        const col = p.up ? '#43a047' : '#e53935';
        ctx.fillStyle = col;
        ctx.fillRect(p.x + 39, p.y - 22, 2, 64);
        R.rrect(p.x + 4, p.y, 72, 20, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(p.x + 8, p.y + 3, 64, 4);
        R.text(p.up ? '▲' : '▼', p.x + 40, p.y + 11, 11, '#fff', 'rgba(0,0,0,0.3)');
      }
    },
  };

  // 警備レーザー：一定の間隔で光る。光っているときに触れるとアウト
  DEF.laser = {
    init(g, W) {
      g.period = g.period || 3;
      if (g.axis === 'h') g.h = haz(W, 'laser', { x: g.c0 * TILE, y: g.r * TILE + 17, w: (g.c1 - g.c0 + 1) * TILE, h: 6, on: false });
      else g.h = haz(W, 'laser', { x: g.c * TILE + 17, y: g.r0 * TILE, w: 6, h: (g.r1 - g.r0) * TILE, on: false });
      DEF.laser.update(g, W);
    },
    update(g, W) {
      const k = cyc(W.clock, g.period, g.off || 0), onT = g.period * (g.duty || 0.5);
      g.h.on = k < onT;
      g.warn = !g.h.on && k > g.period - 0.45;
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, h = g.h, vert = g.axis !== 'h';
      ctx.fillStyle = '#37474f';
      if (vert) { ctx.fillRect(h.x - 7, h.y - 8, 20, 8); ctx.fillRect(h.x - 7, h.y + h.h, 20, 8); }
      else { ctx.fillRect(h.x - 8, h.y - 7, 8, 20); ctx.fillRect(h.x + h.w, h.y - 7, 8, 20); }
      ctx.fillStyle = h.on ? '#ff1744' : g.warn ? '#ffab00' : '#5d4037';
      if (vert) { ctx.fillRect(h.x, h.y - 6, 6, 4); ctx.fillRect(h.x, h.y + h.h + 2, 6, 4); }
      else { ctx.fillRect(h.x - 6, h.y, 4, 6); ctx.fillRect(h.x + h.w + 2, h.y, 4, 6); }
      if (h.on) {
        ctx.fillStyle = 'rgba(255,23,68,0.25)';
        if (vert) ctx.fillRect(h.x - 8, h.y, 22, h.h);
        else ctx.fillRect(h.x, h.y - 8, h.w, 22);
        ctx.fillStyle = '#ff5252';
        ctx.fillRect(h.x, h.y, h.w, h.h);
        ctx.fillStyle = '#fff';
        if (vert) ctx.fillRect(h.x + 2, h.y, 2, h.h);
        else ctx.fillRect(h.x, h.y + 2, h.w, 2);
      } else if (g.warn && Math.sin(t * 40) > 0) {
        ctx.fillStyle = 'rgba(255,82,82,0.5)';
        if (vert) ctx.fillRect(h.x + 2, h.y, 2, h.h);
        else ctx.fillRect(h.x, h.y + 2, h.w, 2);
      }
    },
    light(g) { return g.h.on ? { x: g.h.x + g.h.w / 2, y: g.h.y + g.h.h / 2, r: 60, a: 0.5 } : null; },
  };

  // セキュリティゲート：社員証を持っていれば通れる
  DEF.gate = {
    init(g, W) {
      const r0 = g.r0 == null ? 2 : g.r0;
      g.s = solid(W, g.c * TILE + 6, r0 * TILE, 28, GROUND_Y - r0 * TILE, { gate: true });
    },
    draw(R, g, W, t, me) {
      const ctx = R.ctx, s = g.s, ok = me && me.card;
      ctx.fillStyle = ok ? 'rgba(120,255,200,0.12)' : 'rgba(120,200,255,0.35)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = '#78909c';
      ctx.lineWidth = 3;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(s.x + 5, s.y + 6, 4, s.h - 12);
      ctx.fillStyle = '#37474f';
      ctx.fillRect(s.x - 8, GROUND_Y - 64, 12, 22);
      ctx.fillStyle = ok ? '#00e676' : '#ff1744';
      ctx.fillRect(s.x - 6, GROUND_Y - 61, 8, 5);
      R.text(ok ? 'OK' : '社員証', s.x + s.w / 2, s.y - 10, 10, ok ? '#b9f6ca' : '#fff', 'rgba(0,0,0,0.6)');
    },
  };

  // 承認ハンコブロック：自分がジャンプするたびに「承認」と「却下」が入れ替わる
  DEF.stamp = {
    init(g, W) { g.s = solid(W, g.c * TILE, g.r * TILE, g.n * TILE, TILE, { pl: true, on: g.grp === 0 }); },
    update(g, W, dt, me) { g.s.on = ((me && me.stamp) || 0) % 2 === g.grp; },
    draw(R, g) { drawToggle(R, g.s, g.grp === 0 ? ['#e53935', '#8e0000'] : ['#5c6bc0', '#1a237e'], g.s.on, false, g.grp === 0 ? '承' : '却'); },
  };

  // 大時計の振り子：大きく揺れる振り子に当たるとはじき飛ばされる
  DEF.pendulum = {
    init(g, W) {
      g.px = g.c * TILE + 20;
      g.py = g.r * TILE;
      g.len = (g.len || 7) * TILE;
      g.amp = g.amp || 0.9;
      g.speed = g.speed || 1.4;
      g.h = haz(W, 'pendulum', { circle: true, r: 30 });
      DEF.pendulum.update(g, W);
    },
    update(g, W) {
      g.a = g.amp * Math.sin(W.clock * g.speed + (g.off || 0));
      g.h.cx = g.px + Math.sin(g.a) * g.len;
      g.h.cy = g.py + Math.cos(g.a) * g.len;
    },
    draw(R, g, W, t) {
      const ctx = R.ctx, h = g.h;
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(g.px, g.py);
      ctx.lineTo(h.cx, h.cy);
      ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.beginPath();
      ctx.arc(g.px, g.py, 9, 0, TAU);
      ctx.fill();
      const gr = ctx.createRadialGradient(h.cx - 10, h.cy - 10, 4, h.cx, h.cy, 32);
      gr.addColorStop(0, '#fff59d');
      gr.addColorStop(0.5, '#fbc02d');
      gr.addColorStop(1, '#a1750b');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(h.cx, h.cy, 30, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#7a5600';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.cx, h.cy, 18, 0, TAU);
      ctx.stroke();
    },
  };

  // ワイヤー（ジップライン）：つかまると一気に滑り降りる。ジャンプで手を離す
  DEF.zip = {
    init(g, W) {
      g.x1 = g.c1 * TILE + 20;
      g.y1 = g.r1 * TILE;
      g.x2 = g.c2 * TILE + 20;
      g.y2 = g.r2 * TILE;
      g.len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    },
    touch(g, W, me, api) {
      if (me.zip || me.zipCool > 0 || me.onGround) return;
      const hx = me.x + me.w / 2, hy = me.y - 2;
      const s = clamp(((hx - g.x1) * (g.x2 - g.x1) + (hy - g.y1) * (g.y2 - g.y1)) / (g.len * g.len), 0, 1);
      if (s > 0.95) return;
      const px = g.x1 + (g.x2 - g.x1) * s, py = g.y1 + (g.y2 - g.y1) * s;
      if (Math.hypot(hx - px, hy - py) > 20) return;
      me.zip = { g, s };
      api.sfx('zip');
    },
    draw(R, g, W, t, me) {
      const ctx = R.ctx;
      ctx.fillStyle = '#546e7a';
      ctx.fillRect(g.x1 - 4, g.y1 - 6, 8, GROUND_Y - g.y1 + 6);
      ctx.fillRect(g.x2 - 4, g.y2 - 6, 8, GROUND_Y - g.y2 + 6);
      ctx.strokeStyle = '#263238';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(g.x1, g.y1);
      ctx.lineTo(g.x2, g.y2);
      ctx.stroke();
      const s = me && me.zip && me.zip.g === g ? me.zip.s : 0.03;
      const hx = g.x1 + (g.x2 - g.x1) * s, hy = g.y1 + (g.y2 - g.y1) * s;
      ctx.fillStyle = '#ff7043';
      ctx.fillRect(hx - 10, hy - 3, 20, 6);
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.arc(hx, hy - 4, 5, 0, TAU);
      ctx.fill();
    },
  };

  // ---------- ステージごとの組み立てと進行 ----------
  function build(W, S) {
    W.gim = [];
    W.gplats = [];
    W.gsolids = [];
    W.gzones = [];
    W.ghaz = [];
    W.gitems = [];
    W.dark = !!S.dark;
    for (const d of S.gim || []) {
      const g = Object.assign({}, d);
      W.gim.push(g);
      DEF[g.type].init(g, W);
    }
  }
  function update(W, dt, me) {
    if (!W.gim) return;
    for (const g of W.gim) {
      const d = DEF[g.type];
      if (d.update) d.update(g, W, dt, me);
    }
  }

  // ---------- 自分（操作しているプレイヤー）への作用 ----------
  function reset(me, keep) {
    const old = me.fx || {};
    me.fx = {};
    if (keep) for (const k of keep) if (old[k]) me.fx[k] = old[k];
    me.card = false;
    me.stamp = 0;
    me.zip = null;
    me.djUsed = false;
    me.portalCool = 0;
    me.zipCool = 0;
  }
  function tick(me, dt) {
    const f = me.fx;
    for (const [k] of TIMED) if (f[k] > 0) f[k] = Math.max(0, f[k] - dt);
    me.card = !!f.card;
    if (me.portalCool > 0) me.portalCool -= dt;
    if (me.zipCool > 0) me.zipCool -= dt;
  }
  // 足元と体のまわりの環境（氷・コンベア・水・風）
  function env(W, me) {
    const e = { ice: false, convey: 0, water: null, wx: 0, up: 0 };
    if (!W.gzones) return e;
    const feet = me.y + me.h, cx = me.x + me.w / 2, cy = me.y + me.h / 2;
    for (const z of W.gzones) {
      if (!z.on) continue;
      if (z.kind === 'ice' || z.kind === 'convey') {
        if (!me.onGround || Math.abs(feet - z.y) > 2 || cx < z.x - 8 || cx > z.x + z.w + 8) continue;
        if (z.kind === 'ice') e.ice = true;
        else e.convey += z.vx;
      } else if (cx > z.x && cx < z.x + z.w && cy > z.y && cy < z.y + z.h) {
        if (z.kind === 'water') e.water = z;
        else if (z.kind === 'wind') e.wx += z.vx;
        else if (z.kind === 'up') e.up = Math.max(e.up, z.power);
      }
    }
    return e;
  }
  // 走る速さ・加速・すべりやすさ・ジャンプ力の倍率
  function mods(me, e) {
    const f = me.fx;
    const m = { speed: 1, accel: 1, friction: 1, jump: 1 };
    if (f.speed > 0) { m.speed *= 1.3; m.accel *= 1.3; }
    if (f.board) { m.speed *= 1.22; m.accel *= 1.15; }
    if (f.hijump > 0) m.jump *= 1.2;
    if (e.ice) { m.friction *= 0.12; m.accel *= 0.45; }
    if (e.water) m.speed *= 0.62;
    return m;
  }
  // 水中で泳ぐ：水面近くなら水から飛び出す
  function swimV(me, e, P) {
    return me.y + me.h * 0.5 < e.water.y + 34 ? -P.jumpV : -330;
  }
  // 着地した直後（トランポリン）
  function landed(me, res, api) {
    const l = res.lift;
    if (l && l.spring) bounce(me, l, api);
  }
  function bounce(me, l, api) {
    me.vy = -980;
    me.jumping = true;
    me.onGround = false;
    me.onLift = null;
    me.coyote = 0;
    l.g.squash = 0.18;
    api.sfx('spring');
  }
  // ワイヤーにつかまっているあいだの動き
  function zipStep(me, dt) {
    const z = me.zip, g = z.g;
    z.s = Math.min(1, z.s + (420 * dt) / g.len);
    const px = g.x1 + (g.x2 - g.x1) * z.s, py = g.y1 + (g.y2 - g.y1) * z.s;
    const dir = Math.sign(g.x2 - g.x1) || 1;
    me.facing = dir;
    me.vx = dir * 300;
    me.vy = 0;
    me.onGround = false;
    me.onLift = null;
    me.x = px - me.w / 2;
    me.y = py - 2;
    if (me.jumpBuf > 0 || z.s >= 1) {
      const jumped = me.jumpBuf > 0;
      me.zip = null;
      me.zipCool = 0.4;
      me.jumpBuf = 0;
      if (jumped) { me.vy = -560; me.jumping = true; }
    }
  }
  function hitHaz(me, h) {
    if (h.circle) {
      const nx = clamp(h.cx, me.x, me.x + me.w), ny = clamp(h.cy, me.y, me.y + me.h);
      return (nx - h.cx) ** 2 + (ny - h.cy) ** 2 < h.r * h.r;
    }
    return ov(me, h);
  }
  function useItem(kind, x, y, me, api) {
    const it = ITEMS[kind];
    if (it.fx) Object.assign(me.fx, it.fx);
    if (kind === 'lottery') {
      const r = Math.random();
      const n = r < 0.12 ? 50 : r < 0.5 ? 15 : 5;
      api.addCoins(n, x, y, n >= 50 ? '1 等！賞与 ×50' : n >= 15 ? '当たり！賞与 ×15' : '末等…賞与 ×5');
    } else if (kind === 'clock') api.addTime(15, x, y);
    api.sfx('power');
    api.addScore(500, x, y - 26, `${it.icon} ${it.name}`);
    api.toast(`${it.icon} ${it.name}：${it.text}`, 2800);
  }
  // 毎フレーム：アイテム・危険物・ドアなど
  function interact(W, me, api) {
    if (!W.gim || me.dead) return;
    for (const g of W.gitems) {
      if (g.taken || !ov(me, { x: g.x - 17, y: g.y - 17, w: 34, h: 34 })) continue;
      g.taken = true;
      useItem(g.kind, g.x, g.y, me, api);
    }
    for (const g of W.gim) {
      const d = DEF[g.type];
      if (d.touch) d.touch(g, W, me, api);
    }
    for (const h of W.ghaz) {
      if (!h.on || !hitHaz(me, h)) continue;
      if (h.stomp && me.vy > 0 && me.y + me.h < h.cy - h.r * 0.2) {
        me.vy = -(api.input().jump ? 760 : 520);
        me.jumping = api.input().jump;
        api.sfx('stomp');
        continue;
      }
      if (h.stun) { api.stun(h.stun, h.text); continue; }
      if (me.inv > 0 || me.hurt > 0) continue;
      api.damage(h.kind);
      if (me.dead) return;
    }
    // 磁石：近くの賞与が寄ってくる
    if (me.fx.magnet > 0) {
      const cx = me.x + me.w / 2, cy = me.y + me.h / 2;
      for (const c of W.coins) {
        if (c.taken) continue;
        const dx = cx - c.x, dy = cy - c.y, d = Math.hypot(dx, dy);
        if (d < 230 && d > 1) { c.x += (dx / d) * Math.min(d, 6); c.y += (dy / d) * Math.min(d, 6); }
      }
    }
  }

  // ---------- 描画 ----------
  function draw(R, W, t, me, layer) {
    if (!W.gim) return;
    for (const g of W.gim) {
      const d = DEF[g.type];
      const L = d.layer || 'front';
      if (L === layer && d.draw) d.draw(R, g, W, t, me);
      if (layer === 'front' && d.drawFront) d.drawFront(R, g, W, t, me);
    }
  }
  // 自分のまわりの効果（スケボー・ヘルメット・日傘・効果の残り時間）
  function drawPlayerFx(R, me, t, gliding) {
    if (!me.fx || me.dead) return;
    const ctx = R.ctx, f = me.fx, cx = me.x + me.w / 2;
    if (f.board) {
      R.rrect(cx - 22, me.y + me.h - 2, 44, 6, 3);
      ctx.fillStyle = '#ff7043';
      ctx.fill();
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(cx - 13, me.y + me.h + 6, 3.5, 0, TAU);
      ctx.arc(cx + 13, me.y + me.h + 6, 3.5, 0, TAU);
      ctx.fill();
    }
    if (f.shield) R.emoji('⛑️', cx, me.y - 4, 18);
    if (gliding) {
      ctx.fillStyle = '#ec407a';
      ctx.beginPath();
      ctx.arc(cx, me.y - 6, 26, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, me.y - 6);
      ctx.lineTo(cx, me.y + 18);
      ctx.stroke();
    }
    const icons = TIMED.filter(([k]) => f[k] > 0);
    icons.forEach(([k, ic], i) => {
      if (f[k] < 2 && Math.sin(t * 16) < 0) return;
      R.emoji(ic, cx + (i - (icons.length - 1) / 2) * 18, me.y - (f.shield ? 30 : 16) - (gliding ? 26 : 0), 13);
    });
  }
  // 暗いフロア：自分のまわりと照明のまわりだけ見える
  let darkCv = null;
  function drawDark(R, W, me, x0, y0, w, h) {
    if (!W.dark || !me) return;
    const S = 0.25, cw = Math.max(1, Math.ceil(w * S)), ch = Math.max(1, Math.ceil(h * S));
    if (!darkCv) darkCv = document.createElement('canvas');
    if (darkCv.width !== cw || darkCv.height !== ch) { darkCv.width = cw; darkCv.height = ch; }
    const d = darkCv.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, cw, ch);
    d.fillStyle = 'rgba(3,5,16,0.94)';
    d.fillRect(0, 0, cw, ch);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const X = (x - x0) * S, Y = (y - y0) * S, rr = r * S;
      const gr = d.createRadialGradient(X, Y, 0, X, Y, rr);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(0.55, `rgba(0,0,0,${a * 0.85})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gr;
      d.fillRect(X - rr, Y - rr, rr * 2, rr * 2);
    };
    hole(me.x + me.w / 2, me.y + me.h / 2, me.fx && me.fx.light ? 340 : 135);
    for (const g of W.gim) {
      const L = DEF[g.type].light && DEF[g.type].light(g);
      if (L) hole(L.x, L.y, L.r, L.a || 1);
    }
    for (const x of W.checkpoints) hole(x + 40, GROUND_Y - 100, 90, 0.7);
    hole(W.goalX + 20, GROUND_Y - 90, 160);
    R.ctx.drawImage(darkCv, x0, y0, w, h);
  }

  return {
    ITEMS, build, update, reset, tick, env, mods, swimV, landed, zipStep, interact,
    draw, drawPlayerFx, drawDark, types: Object.keys(DEF),
  };
})();
