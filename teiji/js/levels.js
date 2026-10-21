// ステージデータ
//  横 w マス × 縦 14 段。行 0 が一番上で、地面は 12〜13 行目。1 マス = 40px。
//  ステージは毎回 make() で作り直す（壊したブロックや倒した敵を元に戻すため）。
const Levels = (() => {
  const ROWS = 14;
  const T = { EMPTY: 0, GROUND: 1, BRICK: 2, QBLOCK: 3, USED: 4, SOLID: 5, PIPE: 6, SEMI: 7, HIDDEN: 8 };

  function stage(cfg) {
    const w = cfg.w;
    const tiles = new Uint8Array(w * ROWS);
    const S = Object.assign({}, cfg, {
      rows: ROWS, tiles,
      contents: new Map(), // タイル番号 -> 中身（coin / drink / can / yukyu / coins10）
      enemies: [], coins: [], pipes: [], lifts: [], decor: [], checkpoints: [], goal: null,
    });
    const set = (c, r, t) => { if (c >= 0 && c < w && r >= 0 && r < ROWS) tiles[r * w + c] = t; };
    S.ground = (from, to) => { for (let c = from; c <= to; c++) for (let r = 12; r < ROWS; r++) set(c, r, T.GROUND); return S; };
    S.hole = (from, to) => { for (let c = from; c <= to; c++) for (let r = 12; r < ROWS; r++) set(c, r, T.EMPTY); return S; };
    S.ceiling = (from, to) => { for (let c = from; c <= to; c++) { set(c, 0, T.SOLID); set(c, 1, T.SOLID); } return S; };
    // 1 文字 1 マス：B=レンガ ?=コイン M=ドリンク(?) S=エナドリ缶(?) U=有給(?) C=コイン10枚のレンガ
    //               D=ドリンク入りレンガ K=缶入りレンガ H=隠し有給 X=固いブロック _=空き
    const KIND = {
      B: [T.BRICK], '?': [T.QBLOCK, 'coin'], M: [T.QBLOCK, 'drink'], S: [T.QBLOCK, 'can'], U: [T.QBLOCK, 'yukyu'],
      C: [T.BRICK, 'coins10'], D: [T.BRICK, 'drink'], K: [T.BRICK, 'can'], H: [T.HIDDEN, 'yukyu'], X: [T.SOLID],
    };
    S.blocks = (c, r, str) => {
      [...str].forEach((ch, i) => {
        const k = KIND[ch];
        if (!k) return;
        set(c + i, r, k[0]);
        if (k[1]) S.contents.set(r * w + c + i, k[1]);
      });
      return S;
    };
    // 下から通り抜けられる足場（デスク・棚・ベンチ）
    S.semi = (c, r, n) => { for (let i = 0; i < n; i++) set(c + i, r, T.SEMI); return S; };
    S.column = (c, h) => { for (let k = 0; k < h; k++) set(c, 11 - k, T.SOLID); return S; };
    // 階段：dir=1 で右上がり、-1 で右下がり
    S.stairs = (c, h, dir = 1) => {
      for (let i = 0; i < h; i++) S.column(c + i, dir > 0 ? i + 1 : h - i);
      return S;
    };
    // 土管（2 マス幅、地面から h マス）。phone=true で黒電話が出てくる
    S.pipe = (c, h, phone = false) => {
      const top = 12 - h;
      for (let r = top; r < 12; r++) { set(c, r, T.PIPE); set(c + 1, r, T.PIPE); }
      S.pipes.push({ c, top, phone });
      return S;
    };
    S.coinRow = (c, r, n) => { for (let i = 0; i < n; i++) S.coins.push({ c: c + i, r }); return S; };
    S.enemy = (type, c, r = 11) => { S.enemies.push({ type, c, r }); return S; };
    // 動く足場（エレベーター）。axis='y' なら行 from〜to、'x' なら列 from〜to を往復
    S.lift = (c, r, axis, from, to, speed = 1) => { S.lifts.push({ c, r, axis, from, to, speed }); return S; };
    S.prop = (type, c, r = 12) => { S.decor.push({ type, c, r }); return S; };
    S.checkpoint = c => { S.checkpoints.push(c); return S; };
    S.goalAt = c => { S.goal = c; return S; };
    return S;
  }

  // ---------- 1-1 オフィスフロア ----------
  function stage1() {
    const s = stage({
      id: '1-1', name: 'オフィスフロア', theme: 'office', w: 200, time: 160,
      memo: '業務連絡：フロアにダンボールが散らかっています。踏んで片付けてください。',
    });
    s.ground(0, 63).ground(67, 104).ground(108, 139).ground(145, 199);
    s.prop('plant', 1).coinRow(6, 9, 3);
    s.blocks(11, 8, '?');
    s.blocks(16, 8, 'B?BMB').blocks(18, 4, '?');
    s.enemy('box', 23);
    s.pipe(28, 2).coinRow(31, 7, 3).pipe(36, 3, true);
    s.enemy('box', 42).enemy('box', 44);
    s.pipe(48, 4);
    s.semi(53, 9, 4).coinRow(53, 8, 4);
    s.enemy('virus', 58).prop('plant', 61);
    s.blocks(70, 8, 'BBB?BBB').blocks(71, 4, 'BCB').blocks(75, 4, '?S?');
    s.enemy('box', 74, 7);
    s.enemy('spam', 84, 7).enemy('box', 88).enemy('box', 90);
    s.checkpoint(95);
    s.stairs(99, 4).column(103, 4).column(104, 4);
    s.stairs(108, 4, -1);
    s.enemy('box', 115).enemy('box', 117);
    s.blocks(120, 8, '?B?B?').blocks(128, 8, 'H');
    s.enemy('virus', 125).enemy('virus', 131);
    s.pipe(135, 3, true);
    s.lift(141, 11, 'y', 6, 11).coinRow(141, 4, 2);
    s.enemy('spam', 150, 6);
    s.semi(152, 9, 3).semi(157, 7, 3).coinRow(157, 6, 3);
    s.blocks(164, 8, 'B?B');
    s.enemy('box', 160).enemy('box', 162).enemy('virus', 167);
    s.stairs(172, 8).column(180, 8);
    s.goalAt(188).prop('plant', 194);
    return s;
  }

  // ---------- 1-2 地下書庫 ----------
  function stage2() {
    const s = stage({
      id: '1-2', name: '地下書庫', theme: 'basement', w: 210, time: 170,
      memo: '業務連絡：地下書庫の黒電話が鳴りやみません。絶対に出ないでください。',
    });
    s.ground(0, 46).ground(50, 92).ground(97, 130).ground(138, 209);
    s.ceiling(4, 190);
    s.blocks(9, 8, '?M?');
    s.enemy('box', 15).enemy('box', 17);
    s.blocks(21, 9, 'BBBBBB').blocks(21, 5, 'BBCBBB').coinRow(22, 7, 4);
    s.pipe(31, 3, true);
    s.enemy('virus', 36).enemy('virus', 40);
    s.pipe(43, 2);
    s.blocks(53, 8, 'BBUBB');
    s.enemy('box', 55, 7);
    s.stairs(60, 3);
    s.pipe(66, 4, true);
    s.enemy('box', 71).enemy('box', 73);
    s.pipe(77, 3);
    s.blocks(81, 8, 'B?B');
    s.checkpoint(86);
    s.semi(93, 9, 4).coinRow(93, 8, 4);
    s.enemy('virus', 100).enemy('virus', 103);
    s.blocks(106, 8, '?B?B?').blocks(108, 4, 'K');
    s.pipe(113, 3, true);
    s.enemy('box', 118).enemy('box', 120).enemy('box', 122);
    s.blocks(125, 8, 'H');
    s.lift(131, 10, 'x', 131, 135).coinRow(132, 6, 3);
    s.semi(141, 9, 3).enemy('virus', 146);
    s.blocks(150, 8, 'BBBB').coinRow(150, 7, 4);
    s.stairs(156, 5).column(161, 5);
    s.hole(162, 164);
    s.stairs(165, 5, -1);
    s.pipe(174, 2).pipe(180, 3, true);
    s.enemy('box', 185).enemy('box', 187);
    s.goalAt(198);
    return s;
  }

  // ---------- 1-3 夕暮れのオフィス街 ----------
  function stage3() {
    const s = stage({
      id: '1-3', name: '夕暮れのオフィス街', theme: 'street', w: 230, time: 150, chaser: true,
      memo: '業務連絡：締め切りが追いかけてきます。振り返らずに走ってください。',
    });
    s.ground(0, 42).ground(46, 84).ground(89, 122).ground(127, 168).ground(173, 229);
    s.blocks(10, 8, '?M?');
    s.enemy('spam', 18, 7).enemy('box', 22);
    s.semi(26, 9, 3).semi(30, 7, 3).coinRow(30, 6, 3);
    s.enemy('virus', 35).enemy('spam', 40, 6);
    s.blocks(49, 8, 'BB?BB').blocks(51, 4, 'S');
    s.enemy('box', 55).enemy('box', 57);
    s.pipe(61, 3, true);
    s.enemy('spam', 66, 5).enemy('spam', 70, 8);
    s.semi(73, 9, 4).enemy('virus', 75, 8);
    s.blocks(79, 8, 'B?B');
    s.coinRow(85, 8, 4);
    s.checkpoint(95);
    s.enemy('box', 99).enemy('box', 101).enemy('box', 103);
    s.blocks(106, 8, '?D???');
    s.enemy('spam', 112, 6);
    s.pipe(116, 2);
    s.coinRow(123, 8, 4);
    s.blocks(128, 8, 'H').blocks(130, 8, 'BBCBBB');
    s.enemy('virus', 134).enemy('virus', 137);
    s.semi(141, 9, 3).semi(145, 7, 3).semi(149, 5, 3).coinRow(149, 4, 3);
    s.enemy('spam', 153, 7);
    s.pipe(158, 4, true);
    s.enemy('box', 163).enemy('box', 165);
    s.coinRow(169, 8, 4);
    s.stairs(178, 8).column(186, 8);
    s.goalAt(196);
    return s;
  }

  const list = [stage1, stage2, stage3];
  return {
    ROWS, T,
    count: list.length,
    make: i => list[i](),
    info: i => { const s = list[i](); return { id: s.id, name: s.name, memo: s.memo }; },
  };
})();
