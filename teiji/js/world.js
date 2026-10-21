// ワールド（地形・敵・アイテム・動く足場・締め切り）の状態と更新
//  ひとり / 対戦 / 協力のホストは step() で敵やアイテムを動かす（auth = true）。
//  協力のメンバーは自分では動かさず、ホストから届く snapshot を applySnapshot() で反映する。
const World = (() => {
  const T = Levels.T, ROWS = Levels.ROWS, TILE = 40, VIEW_H = ROWS * TILE;
  const SOLID = new Set([T.GROUND, T.BRICK, T.QBLOCK, T.USED, T.SOLID, T.PIPE]);
  const GRAV = 2200;
  const ENEMY = { box: { w: 34, h: 32 }, virus: { w: 32, h: 30 }, spam: { w: 40, h: 28 }, phone: { w: 34, h: 40 } };
  const ITEM = { drink: { w: 30, h: 36 }, can: { w: 24, h: 34 }, yukyu: { w: 32, h: 34 } };
  const ITEM_CODE = ['drink', 'can', 'yukyu'];
  const STATE_CODE = ['walk', 'flat', 'fall'];
  const LIFT_W = 80, LIFT_H = 14;

  // ゲーム側が上書きする効果の通知先（音・得点表示・メッセージ）
  const World = {
    TILE, VIEW_H, ROWS, T, ENEMY, ITEM, LIFT_W, LIFT_H,
    fx: () => {},
    build, tile, isSolid, moveX, moveY, hitBlock, applyBlock, step, updateLifts, smooth,
    killEnemy, stunChaser, snapshot, applySnapshot, takeItem, spawnItem,
  };
  const fx = (type, data) => World.fx(type, data);

  function build(idx, seq = 0) {
    const S = Levels.make(idx);
    const W = {
      idx, seq, S, w: S.w, tiles: S.tiles, contents: S.contents, pxW: S.w * TILE,
      enemies: [], items: [], itemSeq: 1,
      coins: S.coins.map(c => ({ x: c.c * TILE + TILE / 2, y: c.r * TILE + TILE / 2, taken: false })),
      lifts: S.lifts.map(l => ({ ...l, x: l.c * TILE, y: l.r * TILE, dx: 0, dy: 0 })),
      pipes: S.pipes,
      bumps: new Map(), // タイル番号 -> 叩かれた時刻（ぴょこっと動く演出）
      multi: new Map(), // コイン 10 枚レンガの残り
      particles: [], popups: [],
      checkpoints: S.checkpoints.map(c => c * TILE),
      goalX: S.goal * TILE,
      chaser: S.chaser ? { x: -9999, y: 200, tx: -9999, ty: 200, active: false, wait: 3, stun: 0, vx: 0, warned: false } : null,
      time: S.time, clock: 0,
    };
    S.enemies.forEach(e => W.enemies.push(makeEnemy(W, e.type, e.c * TILE + TILE / 2, (e.r + 1) * TILE)));
    S.pipes.forEach(p => {
      if (!p.phone) return;
      const e = makeEnemy(W, 'phone', (p.c + 1) * TILE, p.top * TILE);
      e.pipeTop = p.top * TILE;
      e.ext = 0;
      e.cycle = 'in';
      e.t = 1 + (p.c % 3) * 0.5;
      W.enemies.push(e);
    });
    updateLifts(W);
    return W;
  }

  function makeEnemy(W, type, cx, bottom) {
    const sz = ENEMY[type];
    const e = {
      n: W.enemies.length, type, w: sz.w, h: sz.h, x: cx - sz.w / 2, y: bottom - sz.h,
      vx: 0, vy: 0, dir: -1, state: 'walk', active: false, gone: false, visible: true,
      onGround: false, t: 0.6 + Math.random() * 0.6, rot: 0, phase: Math.random() * 6,
    };
    e.tx = e.x; e.ty = e.y;
    if (type === 'spam') e.baseY = e.y;
    return e;
  }

  // ---------- 地形 ----------
  function tile(W, c, r) {
    if (r < 0 || r >= ROWS) return T.EMPTY;
    if (c < 0 || c >= W.w) return T.SOLID; // ステージの左右の端は壁
    return W.tiles[r * W.w + c];
  }
  function isSolid(t) {
    return SOLID.has(t);
  }

  function moveX(W, e, dx) {
    if (!dx) return false;
    e.x += dx;
    const r0 = Math.floor(e.y / TILE), r1 = Math.floor((e.y + e.h - 0.01) / TILE);
    const c = dx > 0 ? Math.floor((e.x + e.w) / TILE) : Math.floor(e.x / TILE);
    for (let r = r0; r <= r1; r++) {
      if (isSolid(tile(W, c, r))) {
        e.x = dx > 0 ? c * TILE - e.w - 0.001 : (c + 1) * TILE + 0.001;
        return true;
      }
    }
    return false;
  }

  // 縦移動。着地したら landed、頭をぶつけたら bonk（いちばん近いブロック 1 つ）を返す
  function moveY(W, e, dy, player = false) {
    const out = { landed: false, bonk: null, lift: null };
    if (!dy) return out;
    const prevBottom = e.y + e.h, prevTop = e.y;
    e.y += dy;
    const c0 = Math.floor((e.x + 0.001) / TILE), c1 = Math.floor((e.x + e.w - 0.001) / TILE);
    if (dy > 0) {
      const r = Math.floor((e.y + e.h) / TILE);
      for (let c = c0; c <= c1; c++) {
        const t = tile(W, c, r);
        if (isSolid(t) || (t === T.SEMI && prevBottom <= r * TILE + 0.01)) {
          e.y = r * TILE - e.h;
          out.landed = true;
          return out;
        }
      }
      // 動く足場（上からだけ乗れる）
      for (const l of W.lifts) {
        if (e.x + e.w > l.x + 2 && e.x < l.x + LIFT_W - 2 && prevBottom <= l.y + Math.max(0, l.dy) + 1 && e.y + e.h >= l.y) {
          e.y = l.y - e.h;
          out.landed = true;
          out.lift = l;
          return out;
        }
      }
    } else {
      const r = Math.floor(e.y / TILE);
      let best = null, bestD = 1e9;
      for (let c = c0; c <= c1; c++) {
        const t = tile(W, c, r);
        const hidden = player && t === T.HIDDEN && prevTop >= (r + 1) * TILE - 1;
        if (isSolid(t) || hidden) {
          const d = Math.abs((c + 0.5) * TILE - (e.x + e.w / 2));
          if (d < bestD) { bestD = d; best = { c, r }; }
        }
      }
      if (best) {
        e.y = (r + 1) * TILE;
        out.bonk = best;
      }
    }
    return out;
  }

  // 動く足場は時刻から位置が決まる（協力プレイでも全員の画面で揃う）
  function updateLifts(W) {
    for (const l of W.lifts) {
      const span = (l.to - l.from) * TILE;
      const p = (1 - Math.cos(W.clock * 0.9 * l.speed)) / 2;
      const nx = l.axis === 'x' ? l.from * TILE + span * p : l.c * TILE;
      const ny = l.axis === 'y' ? l.from * TILE + span * p : l.r * TILE;
      l.dx = nx - l.x;
      l.dy = ny - l.y;
      l.x = nx;
      l.y = ny;
    }
  }

  // ---------- ブロック ----------
  // 下から叩いたとき（auth 側、または協力メンバーの先読み）。
  //  local: 自分が叩いた（コインを自分の得点にする） / spawn: アイテムを出す（ホストだけ）
  function hitBlock(W, c, r, big, { local = true, spawn = true } = {}) {
    if (c < 0 || c >= W.w || r < 0 || r >= ROWS) return null;
    const i = r * W.w + c;
    const t = W.tiles[i];
    const content = W.contents.get(i);
    let res = null;
    if (t === T.QBLOCK || t === T.HIDDEN || (t === T.BRICK && content)) {
      if (content === 'coins10') {
        const left = (W.multi.has(i) ? W.multi.get(i) : 10) - 1;
        W.multi.set(i, left);
        if (left <= 0) W.tiles[i] = T.USED;
        coinPop(W, c, r, local);
        res = 'coin';
      } else {
        W.tiles[i] = T.USED;
        if (!content || content === 'coin') {
          coinPop(W, c, r, local);
          res = 'coin';
        } else {
          if (spawn) spawnItem(W, content, c, r);
          fx('sfx', 'sprout');
          if (t === T.HIDDEN) fx('toast', '隠し有給を発見！');
          res = 'item';
        }
      }
      bump(W, c, r);
    } else if (t === T.BRICK) {
      if (big) {
        W.tiles[i] = T.EMPTY;
        debris(W, c, r);
        fx('sfx', 'break');
        if (local) fx('score', { x: c * TILE + TILE / 2, y: r * TILE, n: 50 });
        res = 'break';
      } else {
        bump(W, c, r);
        fx('sfx', 'bump');
        res = 'bump';
      }
    } else {
      fx('sfx', 'thud');
      return null;
    }
    if (spawn) killOnTop(W, c, r, local);
    return res;
  }

  // 協力メンバー：ホストが確定したブロックの変化を反映する
  function applyBlock(W, c, r, t, fxName) {
    const i = r * W.w + c;
    if (i < 0 || i >= W.tiles.length) return;
    const before = W.tiles[i];
    W.tiles[i] = t;
    if (fxName === 'break' && before !== T.EMPTY) { debris(W, c, r); fx('sfx', 'break'); }
    else if (fxName === 'coin') { bump(W, c, r); coinPop(W, c, r, false); }
    else if (fxName) { bump(W, c, r); if (fxName === 'item') fx('sfx', 'sprout'); }
  }

  function bump(W, c, r) {
    W.bumps.set(r * W.w + c, W.clock);
  }
  function coinPop(W, c, r, local) {
    W.particles.push({ kind: 'coin', x: c * TILE + TILE / 2, y: r * TILE - 10, vy: -560, life: 0.5, t: 0 });
    fx('coin', { local, x: c * TILE + TILE / 2, y: r * TILE - 20 });
  }
  function debris(W, c, r) {
    const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 0.2], [1, 0.2]]) {
      W.particles.push({ kind: 'debris', theme: W.S.theme, x: x + dx * 8, y: y + dy * 8, vx: dx * 140, vy: -520 + dy * 240, life: 1.2, t: 0, rot: 0 });
    }
  }
  function killOnTop(W, c, r, local) {
    for (const e of W.enemies) {
      if (!e.active || e.gone || e.state !== 'walk' || e.type === 'phone') continue;
      const bottom = e.y + e.h;
      if (Math.abs(bottom - r * TILE) < 4 && e.x + e.w > c * TILE && e.x < (c + 1) * TILE) killEnemy(W, e, 'fall', local);
    }
  }

  function spawnItem(W, type, c, r, id) {
    const sz = ITEM[type];
    const it = {
      id: id || W.itemSeq++, type, w: sz.w, h: sz.h, x: c * TILE + (TILE - sz.w) / 2, y: r * TILE + TILE - sz.h,
      baseY: r * TILE - sz.h, emerge: 0.6, vx: 0, vy: 0, dir: 1, gone: false,
    };
    it.startY = it.y;
    W.items.push(it);
    return it;
  }
  function takeItem(W, id) {
    const it = W.items.find(i => i.id === id);
    if (it) it.gone = true;
    W.items = W.items.filter(i => !i.gone);
  }

  // ---------- 敵 ----------
  // how: 'flat'（踏まれてぺちゃんこ） / 'fall'（ひっくり返って落ちる）
  function killEnemy(W, e, how, local) {
    if (e.gone || e.state !== 'walk') return false;
    if (how === 'flat' && e.type !== 'box') how = 'fall';
    e.state = how;
    e.t = how === 'flat' ? 0.6 : 0;
    if (how === 'fall') { e.vy = -420; e.vx = (Math.random() < 0.5 ? -1 : 1) * 60; }
    fx('enemyDown', { e, local });
    return true;
  }

  function stunChaser(W) {
    const C = W.chaser;
    if (!C || !C.active || C.stun > 0) return false;
    C.stun = 2.5;
    C.vx = -220;
    return true;
  }

  function nearest(players, x) {
    let best = null, d = Infinity;
    for (const p of players) {
      if (p.dead) continue;
      const dd = Math.abs(p.x - x);
      if (dd < d) { d = dd; best = p; }
    }
    return best;
  }

  // players: [{ x, y, w, h, dead }]（敵が向かう相手・出現判定に使う）
  function step(W, dt, players, activateRight) {
    W.clock += dt;
    updateLifts(W);
    let reach = activateRight || 0;
    for (const p of players) reach = Math.max(reach, p.x + 820);

    for (const e of W.enemies) {
      if (e.gone) continue;
      if (!e.active) {
        if (e.x < reach) e.active = true;
        else continue;
      }
      if (e.state === 'flat') {
        e.t -= dt;
        if (e.t <= 0) e.gone = true;
        continue;
      }
      if (e.state === 'fall') {
        e.vy += GRAV * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.rot += dt * 8;
        if (e.y > VIEW_H + 80) e.gone = true;
        continue;
      }
      switch (e.type) {
        case 'box': {
          e.vx = 62 * e.dir;
          e.vy = Math.min(900, e.vy + GRAV * dt);
          if (moveX(W, e, e.vx * dt)) e.dir *= -1;
          const r = moveY(W, e, e.vy * dt);
          if (r.landed) e.vy = 0;
          e.onGround = r.landed;
          if (r.lift) e.x += r.lift.dx;
          e.phase += dt * 7;
          break;
        }
        case 'virus': {
          e.vy = Math.min(900, e.vy + GRAV * dt);
          if (e.onGround) {
            e.vx *= Math.max(0, 1 - dt * 10);
            e.t -= dt;
            if (e.t <= 0) {
              const p = nearest(players, e.x);
              if (p) e.dir = p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1;
              e.vy = -560;
              e.vx = 95 * e.dir;
              e.t = 1.0 + Math.random() * 0.5;
              e.onGround = false;
            }
          }
          if (moveX(W, e, e.vx * dt)) { e.dir *= -1; e.vx = -e.vx; }
          const r = moveY(W, e, e.vy * dt);
          if (r.landed) { if (!e.onGround) e.squash = 0.15; e.vy = 0; e.onGround = true; }
          else if (r.bonk) e.vy = 60;
          if (e.squash) e.squash = Math.max(0, e.squash - dt);
          e.rot += dt * (e.onGround ? 0.5 : 4) * e.dir;
          break;
        }
        case 'spam': {
          e.x += -74 * dt;
          e.y = e.baseY + Math.sin(W.clock * 2.4 + e.phase) * 34;
          if (e.x < -80) e.gone = true;
          break;
        }
        case 'phone': {
          e.t -= dt;
          const cx = e.x + e.w / 2;
          if (e.cycle === 'in' && e.t <= 0) {
            // 土管のすぐ横に人がいるときは出てこない
            const near = players.some(p => !p.dead && Math.abs(p.x + p.w / 2 - cx) < 70);
            if (near) e.t = 0.4;
            else { e.cycle = 'rise'; e.t = 0.5; fx('ring', { x: cx }); }
          } else if (e.cycle === 'rise') {
            e.ext = Math.min(1, 1 - e.t / 0.5);
            if (e.t <= 0) { e.cycle = 'out'; e.t = 1.4; e.ext = 1; }
          } else if (e.cycle === 'out') {
            if (e.t <= 0) { e.cycle = 'sink'; e.t = 0.5; }
          } else if (e.cycle === 'sink') {
            e.ext = Math.max(0, e.t / 0.5);
            if (e.t <= 0) { e.cycle = 'in'; e.t = 2.0; e.ext = 0; }
          }
          e.y = e.pipeTop - e.ext * 44;
          break;
        }
      }
      if (e.y > VIEW_H + 80) e.gone = true;
    }
    // 歩く敵どうしがぶつかったら向きを変える
    const walkers = W.enemies.filter(e => e.active && !e.gone && e.state === 'walk' && (e.type === 'box' || e.type === 'virus'));
    for (let a = 0; a < walkers.length; a++) {
      for (let b = a + 1; b < walkers.length; b++) {
        const A = walkers[a], B = walkers[b];
        if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) {
          if (A.x < B.x) { A.dir = -1; B.dir = 1; } else { A.dir = 1; B.dir = -1; }
          if (A.type === 'virus') A.vx = Math.abs(A.vx) * A.dir;
          if (B.type === 'virus') B.vx = Math.abs(B.vx) * B.dir;
        }
      }
    }
    W.enemies.forEach(e => { e.tx = e.x; e.ty = e.y; });

    // アイテム
    for (const it of W.items) {
      if (it.emerge > 0) {
        it.emerge -= dt;
        it.y = it.startY - (1 - Math.max(0, it.emerge) / 0.6) * (it.startY - it.baseY);
        if (it.emerge <= 0) {
          const p = nearest(players, it.x);
          it.dir = p && p.x + p.w / 2 > it.x + it.w / 2 + 4 ? -1 : 1;
          it.vx = (it.type === 'can' ? 130 : 95) * it.dir;
          if (it.type === 'can') it.vy = -380;
        }
        continue;
      }
      it.vy = Math.min(900, it.vy + GRAV * dt);
      if (moveX(W, it, it.vx * dt)) it.vx = -it.vx;
      const r = moveY(W, it, it.vy * dt);
      if (r.landed) it.vy = it.type === 'can' ? -480 : 0;
      else if (r.bonk) it.vy = 40;
      if (it.y > VIEW_H + 60) it.gone = true;
    }
    if (W.items.some(i => i.gone)) W.items = W.items.filter(i => !i.gone);

    // 締め切り：いちばん後ろを走っている人を追いかける
    const C = W.chaser;
    if (C) {
      const alive = players.filter(p => !p.dead);
      const target = alive.length ? alive.reduce((a, b) => (b.x < a.x ? b : a)) : null;
      if (!C.active) {
        C.wait -= dt;
        if (C.wait <= 0 && target) {
          C.active = true;
          C.x = target.x - 560;
          C.y = Math.min(300, target.y - 60);
          fx('chaser', null);
        }
      } else if (target) {
        if (C.stun > 0) {
          C.stun -= dt;
          C.vx *= Math.max(0, 1 - dt * 2);
        } else {
          const dx = target.x + target.w / 2 - C.x;
          const sp = dx > 560 ? 320 : 156;
          C.vx = Math.abs(dx) < 6 ? 0 : Math.sign(dx) * sp;
          C.y += (target.y - 30 - C.y) * Math.min(1, dt * 1.5);
        }
        C.x += C.vx * dt;
      }
      C.tx = C.x;
      C.ty = C.y;
    }
  }

  // 協力メンバー：届いた位置へなめらかに寄せる
  function smooth(W, dt) {
    const k = Math.min(1, dt * 14);
    for (const e of W.enemies) {
      if (Math.abs(e.tx - e.x) > 160 || Math.abs(e.ty - e.y) > 160) { e.x = e.tx; e.y = e.ty; }
      else { e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; }
      if (e.state === 'fall') e.rot += dt * 8;
      else if (e.type === 'box') e.phase += dt * 7;
      else if (e.type === 'virus') e.rot += dt * 1.5;
    }
    for (const it of W.items) {
      it.x += (it.tx - it.x) * k;
      it.y += (it.ty - it.y) * k;
    }
    const C = W.chaser;
    if (C) {
      if (Math.abs(C.tx - C.x) > 300) C.x = C.tx;
      C.x += (C.tx - C.x) * k;
      C.y += (C.ty - C.y) * k;
    }
  }

  // ---------- 協力プレイの同期 ----------
  const r1 = v => Math.round(v);
  function snapshot(W) {
    return {
      sq: W.seq, ck: Math.round(W.clock * 100) / 100, tm: Math.max(0, Math.round(W.time * 10) / 10),
      e: W.enemies.filter(e => e.active && !e.gone).map(e => [e.n, r1(e.x), r1(e.y), STATE_CODE.indexOf(e.state), e.dir, e.ext != null ? Math.round(e.ext * 100) : 0]),
      it: W.items.map(it => [it.id, ITEM_CODE.indexOf(it.type), r1(it.x), r1(it.y)]),
      ch: W.chaser && W.chaser.active ? [r1(W.chaser.x), r1(W.chaser.y), W.chaser.stun > 0 ? 1 : 0] : null,
    };
  }

  // killedLocally: 自分が踏んだばかりの敵（ホストの確定が届くまで消えたように見せる）
  function applySnapshot(W, s, killedLocally) {
    if (Math.abs(W.clock - s.ck) > 0.15) W.clock = s.ck;
    W.time = s.tm;
    const seen = new Set();
    for (const [n, x, y, st, dir, ext] of s.e) {
      const e = W.enemies[n];
      if (!e) continue;
      seen.add(n);
      const state = STATE_CODE[st] || 'walk';
      if (!e.active) { e.x = x; e.y = y; }
      e.active = true;
      e.visible = true;
      e.tx = x;
      e.ty = y;
      e.dir = dir;
      e.ext = ext / 100;
      if (state !== 'walk' && e.state === 'walk') { e.state = state; e.t = 0.6; }
      else if (state === 'walk' && !killedLocally.has(n)) e.state = 'walk';
    }
    for (const e of W.enemies) if (!seen.has(e.n) && e.active) { e.visible = false; if (e.state !== 'walk') e.gone = true; }
    const items = new Map(W.items.map(i => [i.id, i]));
    W.items = s.it.map(([id, code, x, y]) => {
      let it = items.get(id);
      if (!it) {
        const type = ITEM_CODE[code];
        it = { id, type, w: ITEM[type].w, h: ITEM[type].h, x, y, vx: 0, vy: 0, emerge: 0 };
      }
      it.tx = x;
      it.ty = y;
      return it;
    });
    const C = W.chaser;
    if (C) {
      if (s.ch) {
        if (!C.active) { C.x = s.ch[0]; C.y = s.ch[1]; }
        C.active = true;
        C.tx = s.ch[0];
        C.ty = s.ch[1];
        C.stun = s.ch[2] ? 1 : 0;
      } else C.active = false;
    }
  }

  return World;
})();
