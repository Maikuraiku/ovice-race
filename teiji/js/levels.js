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
    // 壁（地面から高さ h、幅 n）
    S.wall = (c, h, n = 1) => { for (let i = 0; i < n; i++) S.column(c + i, h); return S; };
    // ---- ギミックとアイテム（gimmicks.js） ----
    S.gim = [];
    S.g = (type, o) => { S.gim.push(Object.assign({ type }, o)); return S; };
    S.item = (kind, c, r) => S.g('item', { kind, c, r });
    S.spring = (c, r = 11) => S.g('spring', { c, r });
    S.cart = (c, to, r = 11) => S.g('cart', { c, to, r });
    S.gate = (c, r0 = 2) => S.g('gate', { c, r0 });
    S.zip = (c1, r1, c2, r2) => S.g('zip', { c1, r1, c2, r2 });
    S.stamp = (c, r, n, grp) => S.g('stamp', { c, r, n, grp });
    S.stampWall = (c, h, grp) => { for (let r = 12 - h; r < 12; r++) S.stamp(c, r, 1, grp); return S; };
    S.breakerWall = (c, h, grp) => { for (let r = 12 - h; r < 12; r++) S.g('breaker', { c, r, n: 1, grp }); return S; };
    // ベルトコンベア（固いブロックの上を流れる）
    S.conveyor = (c, r, n, dir) => { for (let i = 0; i < n; i++) set(c + i, r, T.SOLID); return S.g('conveyor', { c, r, n, dir }); };
    // プール（左右の壁と、行 r から下が水）
    S.pool = (c, n, r) => { for (let k = r; k < 12; k++) { set(c - 1, k, T.SOLID); set(c + n, k, T.SOLID); } return S.g('pool', { c, n, r }); };
    // 打ち上げ花火の筒（高さ 2 の固いブロック）
    S.tube = (c, off = 0) => { set(c, 10, T.SOLID); set(c, 11, T.SOLID); return S.g('firework', { c, off }); };
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

  // ================= ワールド 2：春・新年度 =================
  // 2-1：研修用トランポリンで、だんだん高くなる壁を跳び越える ／ コーヒー
  function stage2_1() {
    const s = stage({
      id: '2-1', name: '新人研修フロア', theme: 'training', w: 210, time: 170,
      memo: '業務連絡：研修用トランポリンは、ジャンプ長押しで高く跳べます。定時退社も研修の一環です。',
    });
    s.ground(0, 72).ground(76, 128).ground(133, 170).ground(174, 209);
    s.prop('plant', 1);
    s.item('coffee', 8, 10);
    s.blocks(11, 8, '?M?');
    s.enemy('box', 16);
    s.spring(19).wall(21, 5, 2).coinRow(19, 3, 4);
    s.enemy('box', 27);
    s.spring(30).wall(32, 6, 2).coinRow(29, 2, 5);
    s.enemy('virus', 37);
    s.spring(41).wall(43, 7, 2).semi(45, 5, 6).coinRow(45, 4, 6).enemy('box', 47, 4);
    s.enemy('box', 49);
    s.blocks(55, 8, 'B?B?B');
    s.pipe(62, 3, true);
    s.coinRow(73, 8, 3);
    s.item('coffee', 79, 10);
    s.enemy('box', 85).enemy('box', 88).enemy('virus', 92).enemy('spam', 96, 7);
    s.blocks(99, 8, '?C?');
    s.checkpoint(104);
    s.spring(113).semi(109, 4, 9).coinRow(109, 3, 9);
    s.enemy('box', 118).enemy('box', 121);
    s.coinRow(129, 8, 4);
    s.blocks(137, 8, 'BHB');
    s.enemy('virus', 142).enemy('virus', 145);
    s.pipe(150, 4);
    s.spring(157).wall(159, 8, 2).coinRow(157, 2, 4);
    s.enemy('box', 165);
    s.coinRow(171, 8, 3);
    s.goalAt(190).prop('plant', 197);
    return s;
  }

  // 2-2：天井の低い倉庫。逆向きのベルトコンベアの橋と、乗ると動く運搬台車で大穴を渡る
  function stage2_2() {
    const s = stage({
      id: '2-2', name: '備品倉庫', theme: 'warehouse', w: 220, time: 180,
      memo: '業務連絡：ベルトコンベアと運搬台車はご自由にどうぞ。台車は乗ると動き出します。',
    });
    s.ground(0, 30).ground(42, 70).ground(84, 120).ground(134, 160).ground(176, 219);
    s.ceiling(4, 200);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('box', 16);
    s.conveyor(19, 11, 8, -1).coinRow(19, 9, 8);
    s.conveyor(32, 10, 9, -1).enemy('spam', 37, 6);
    s.conveyor(46, 8, 6, 1).coinRow(46, 7, 6);
    s.enemy('box', 50).enemy('box', 53);
    s.blocks(56, 8, 'BB?BB');
    s.pipe(64, 3, true);
    s.cart(71, 82).coinRow(74, 7, 7);
    s.checkpoint(87);
    s.enemy('virus', 96).enemy('virus', 99);
    s.blocks(102, 9, 'BBBBBBBB').blocks(102, 5, 'B?BBK?BB').coinRow(103, 7, 6);
    s.conveyor(112, 11, 6, 1).enemy('box', 114, 10);
    s.conveyor(122, 10, 4, 1).conveyor(128, 8, 3, -1).coinRow(128, 7, 3);
    s.enemy('box', 138).enemy('box', 140).enemy('virus', 145);
    s.blocks(148, 8, '?S?');
    s.pipe(154, 2);
    s.cart(161, 173).coinRow(163, 7, 9);
    s.enemy('box', 182).enemy('box', 184);
    s.stairs(188, 5).column(193, 5).stairs(194, 5, -1);
    s.goalAt(208);
    return s;
  }

  // 2-3：ビルの屋上を渡り歩く。シャボン玉で高い屋上へ、日傘で遠くへ
  function stage2_3() {
    const s = stage({
      id: '2-3', name: 'お花見の屋上', theme: 'sakura_roof', w: 214, time: 170,
      memo: '業務連絡：シャボン玉に乗れば高い屋上へ。日傘があれば、ジャンプ長押しで遠くまでふわっと降りられます。',
    });
    s.ground(0, 30).ground(38, 60).ground(70, 92).ground(104, 126).ground(138, 160).ground(172, 213);
    s.blocks(7, 8, '?M?');
    s.enemy('box', 13);
    s.g('bubble', { c: 18, top: 3 });
    s.wall(21, 7, 9).coinRow(22, 4, 3).item('parasol', 26, 4);
    s.coinRow(30, 3, 3);
    s.enemy('virus', 44).enemy('box', 48);
    s.blocks(51, 8, 'B?B');
    s.wall(56, 4, 5).coinRow(56, 7, 5);
    s.wall(65, 3, 1).g('bubble', { c: 65, r0: 8, top: 1 }).coinRow(64, 2, 3);
    s.enemy('box', 75).enemy('spam', 80, 6);
    s.g('bubble', { c: 83, top: 2 });
    s.wall(86, 6, 7).item('parasol', 89, 5).coinRow(86, 5, 3);
    s.wall(98, 4, 2).coinRow(95, 5, 8);
    s.checkpoint(106);
    s.enemy('virus', 113).enemy('virus', 116);
    s.blocks(119, 8, '?S?');
    s.g('bubble', { c: 121, top: 3 });
    s.wall(124, 5, 3);
    s.wall(131, 4, 2).coinRow(129, 5, 7);
    s.enemy('box', 142).enemy('box', 144);
    s.blocks(148, 8, 'BCB');
    s.g('bubble', { c: 153, top: 2 });
    s.wall(156, 7, 5).coinRow(156, 4, 3).item('parasol', 159, 4);
    s.wall(165, 5, 2).coinRow(162, 4, 8);
    s.prop('plant', 176).enemy('box', 182);
    s.goalAt(196);
    return s;
  }

  // 2-4：横断歩道が続く帰り道。赤信号のあいだは車が横切る（締め切りも追ってくる）
  function stage2_4() {
    const s = stage({
      id: '2-4', name: '桜並木の帰り道', theme: 'sakura_street', w: 216, time: 150, chaser: true,
      memo: '業務連絡：年度初めの締め切りが追いかけてきます。それでも赤信号は守ってください（車は跳び越えられます）。',
    });
    s.ground(0, 52).ground(56, 104).ground(109, 160).ground(164, 215);
    s.blocks(9, 8, '?M?');
    s.enemy('box', 14);
    s.g('traffic', { c: 20, n: 6 });
    s.item('sneaker', 30, 10);
    s.enemy('spam', 36, 6).enemy('box', 40);
    s.semi(43, 9, 3).semi(47, 7, 3).coinRow(47, 6, 3);
    s.coinRow(53, 8, 3);
    s.g('traffic', { c: 60, n: 7, off: 2.5 });
    s.enemy('virus', 70).enemy('box', 74);
    s.blocks(78, 8, 'B?B?B').blocks(80, 4, 'H');
    s.pipe(86, 3, true);
    s.enemy('spam', 92, 7);
    s.checkpoint(96);
    s.coinRow(105, 8, 4);
    s.item('sneaker', 111, 10);
    s.g('traffic', { c: 114, n: 8, off: 5 });
    s.enemy('box', 125).enemy('box', 127);
    s.blocks(130, 8, '?S?');
    s.pipe(136, 4);
    s.enemy('virus', 142).enemy('spam', 148, 6);
    s.semi(151, 9, 3).semi(155, 7, 3).coinRow(155, 6, 3);
    s.coinRow(161, 8, 3);
    s.g('traffic', { c: 168, n: 6, off: 1.2 });
    s.enemy('box', 177);
    s.stairs(181, 6).column(187, 6);
    s.goalAt(198);
    return s;
  }

  // ================= ワールド 3：夏・繁忙期 =================
  // 3-1：扇風機の風に乗って穴を越える。上の階は向かい風 ／ クリップ磁石
  function stage3_1() {
    const s = stage({
      id: '3-1', name: '冷房の効かないフロア', theme: 'hot_office', w: 203, time: 160,
      memo: '業務連絡：節電のため冷房は 28 度設定です。扇風機の風を上手に使ってください。',
    });
    s.ground(0, 40).ground(46, 96).ground(102, 150).ground(156, 202);
    s.blocks(8, 8, '?M?');
    s.item('magnet', 13, 10);
    s.coinRow(15, 7, 3).coinRow(19, 6, 3).coinRow(23, 7, 3);
    s.enemy('box', 20).enemy('box', 24);
    s.semi(28, 8, 4).coinRow(28, 7, 4);
    s.g('fan', { c: 35, dir: 1, len: 12 });
    s.coinRow(41, 9, 5);
    s.enemy('virus', 50);
    s.wall(55, 4, 2).semi(57, 8, 15).coinRow(57, 7, 15).enemy('box', 64, 7);
    s.column(73, 4).g('fan', { c: 73, r: 7, dir: -1, len: 10 });
    s.enemy('box', 61).enemy('box', 67);
    s.blocks(77, 8, 'B?B?B');
    s.pipe(84, 3, true);
    s.g('fan', { c: 90, dir: 1, len: 13 });
    s.coinRow(97, 9, 5);
    s.checkpoint(104);
    s.enemy('spam', 112, 7).enemy('virus', 116);
    s.item('magnet', 118, 10);
    s.blocks(121, 8, 'CBC');
    s.g('fan', { c: 129, dir: -1, len: 7 });
    s.semi(132, 9, 3).semi(136, 7, 3).coinRow(136, 6, 3);
    s.enemy('box', 140).enemy('box', 142);
    s.pipe(144, 3, true);
    s.column(148, 4).g('fan', { c: 148, r: 7, dir: 1, len: 10 });
    s.coinRow(151, 7, 5);
    s.enemy('box', 162);
    s.blocks(166, 8, 'H');
    s.stairs(172, 8).column(180, 8);
    s.goalAt(191);
    return s;
  }

  // 3-2：ラックの塔を排熱ダクトの上昇気流で越える。床はときどき熱暴走する
  function stage3_2() {
    const s = stage({
      id: '3-2', name: '熱暴走サーバールーム', theme: 'hot_server', w: 219, time: 170,
      memo: '業務連絡：サーバーが熱暴走しています。赤く光る床に注意。排熱ダクトの風に乗ると高く上がれます。',
    });
    s.ground(0, 58).ground(63, 138).ground(143, 218);
    s.ceiling(4, 200);
    s.blocks(8, 8, '?M?');
    s.enemy('virus', 12);
    s.g('hotfloor', { c: 15, r: 12, n: 6 });
    s.g('updraft', { c: 23, top: 3 }).wall(25, 7, 3).coinRow(25, 4, 3);
    s.g('hotfloor', { c: 29, r: 12, n: 8, off: 1.5 });
    s.enemy('virus', 32).enemy('virus', 35);
    s.blocks(40, 9, 'BBBBBB').blocks(40, 5, 'B?BB?B').coinRow(41, 7, 4);
    s.g('hotfloor', { c: 40, r: 9, n: 6, off: 3 });
    s.pipe(47, 3, true);
    s.g('updraft', { c: 51, top: 3 }).wall(53, 7, 2).wall(55, 5, 2).coinRow(52, 4, 4);
    s.coinRow(59, 8, 4);
    s.enemy('box', 66).enemy('box', 68);
    s.g('hotfloor', { c: 71, r: 12, n: 10, off: 0.7 });
    s.semi(72, 9, 3).semi(76, 9, 3);
    s.checkpoint(84);
    s.g('updraft', { c: 92, top: 3 }).wall(94, 7, 6).coinRow(94, 4, 6).enemy('virus', 97, 4);
    s.pipe(104, 4, true);
    s.g('hotfloor', { c: 108, r: 12, n: 12, off: 2 });
    s.blocks(110, 8, 'BSB').blocks(116, 8, '?B?');
    s.enemy('virus', 113).enemy('virus', 118);
    s.g('updraft', { c: 124, top: 3 }).wall(126, 6, 4).coinRow(126, 5, 4);
    s.coinRow(139, 8, 4);
    s.enemy('box', 147).enemy('virus', 151);
    s.g('hotfloor', { c: 154, r: 12, n: 6, off: 1 });
    s.blocks(156, 8, 'H');
    s.g('updraft', { c: 163, top: 3 }).wall(165, 7, 4).g('hotfloor', { c: 165, r: 5, n: 4, off: 2.5 });
    s.pipe(178, 2).pipe(184, 3, true);
    s.enemy('virus', 190);
    s.goalAt(204);
    return s;
  }

  // 3-3：屋上プールを泳いで渡り、深いプールから高い塀を越える ／ 安全ヘルメット
  function stage3_3() {
    const s = stage({
      id: '3-3', name: '炎天下の屋上', theme: 'summer_roof', w: 203, time: 160,
      memo: '業務連絡：屋上のビアガーデンは 18 時開店です。プールではジャンプで泳げます（水面から飛び出せます）。',
    });
    s.ground(0, 97).ground(102, 159).ground(164, 202);
    s.blocks(8, 8, '?M?');
    s.item('helmet', 13, 10);
    s.enemy('box', 17);
    s.pool(22, 8, 8).coinRow(23, 10, 6);
    s.enemy('spam', 34, 6).enemy('box', 37);
    s.stairs(40, 4).pool(45, 7, 5).coinRow(46, 9, 5).coinRow(46, 6, 5);
    s.semi(53, 3, 6).coinRow(53, 2, 6);
    s.enemy('virus', 57).enemy('virus', 60);
    s.blocks(64, 8, 'B?B?B');
    s.pipe(70, 3, true);
    s.stairs(75, 3).pool(79, 10, 7).coinRow(80, 10, 8);
    s.checkpoint(91);
    s.coinRow(98, 8, 4);
    s.enemy('box', 106).enemy('spam', 109, 6);
    s.item('helmet', 111, 10);
    s.stairs(113, 4).pool(118, 6, 5).wall(125, 9, 2).coinRow(119, 8, 4).coinRow(125, 2, 2);
    s.enemy('virus', 131).enemy('virus', 134);
    s.blocks(138, 8, 'BBCBB').enemy('box', 140, 7);
    s.pool(146, 8, 9).coinRow(147, 10, 6).enemy('box', 150);
    s.coinRow(160, 8, 4);
    s.enemy('spam', 168, 6);
    s.stairs(172, 8).column(180, 8);
    s.goalAt(191);
    return s;
  }

  // 3-4：揺れる提灯に飛び移って穴を越え、打ち上げ花火で屋台の屋根へ
  function stage3_4() {
    const s = stage({
      id: '3-4', name: '夏祭りの商店街', theme: 'festival', w: 210, time: 170,
      memo: '業務連絡：揺れる提灯には乗れます。花火の筒の上にいると、打ち上げと一緒に空高く飛ばされます。',
    });
    s.ground(0, 30).ground(42, 70).ground(84, 112).ground(124, 150).ground(164, 209);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('spam', 20, 7);
    s.g('lantern', { c: 36, r: 2, len: 8, amp: 0.7, speed: 1.2 }).coinRow(33, 6, 7);
    s.enemy('virus', 47);
    s.tube(51).coinRow(50, 2, 3);
    s.semi(53, 4, 8).coinRow(53, 3, 8);
    s.enemy('box', 56).enemy('box', 58);
    s.blocks(62, 8, 'B?B');
    s.g('lantern', { c: 74, r: 2, len: 8, amp: 0.6, speed: 1.2 }).g('lantern', { c: 80, r: 2, len: 8, amp: 0.6, speed: 1.2, off: Math.PI });
    s.coinRow(73, 5, 9);
    s.checkpoint(87);
    s.enemy('virus', 95).enemy('virus', 98);
    s.tube(102, 1.2).wall(104, 7, 3).coinRow(104, 4, 3);
    s.enemy('spam', 109, 6);
    s.g('lantern', { c: 118, r: 2, len: 8, amp: 0.7, speed: 1.2, off: 1.5 }).coinRow(115, 6, 7);
    s.enemy('box', 128).enemy('box', 130);
    s.blocks(133, 8, '?D?');
    s.tube(140, 2).semi(142, 3, 6).coinRow(142, 2, 6);
    s.enemy('virus', 146);
    s.g('lantern', { c: 154, r: 2, len: 8, amp: 0.6, speed: 1.2 }).g('lantern', { c: 160, r: 2, len: 8, amp: 0.6, speed: 1.2, off: Math.PI });
    s.enemy('box', 170);
    s.tube(176, 0.6).wall(178, 6, 2);
    s.goalAt(194);
    return s;
  }

  // ================= ワールド 4：秋・監査シーズン =================
  // 4-1：天井の低い書庫。乗ると崩れる書類の山で穴を渡り、落ちてくるファイルをかわす
  function stage4_1() {
    const s = stage({
      id: '4-1', name: '監査前の書庫', theme: 'archive', w: 220, time: 170,
      memo: '業務連絡：明日は監査です。書類の山は乗ると崩れます。真上の重要ファイルにも気をつけて。',
    });
    s.ground(0, 34).ground(44, 80).ground(92, 128).ground(140, 176).ground(186, 219);
    s.ceiling(4, 206);
    s.blocks(8, 8, '?M?');
    s.g('fallingfile', { c: 15, r: 2 }).g('fallingfile', { c: 19, r: 2 });
    s.enemy('box', 24).enemy('box', 27);
    s.g('fallingfile', { c: 30, r: 2 });
    s.g('crumble', { c: 36, r: 10, n: 3 }).g('crumble', { c: 40, r: 9, n: 2 }).coinRow(36, 8, 3);
    s.enemy('virus', 50);
    s.blocks(54, 9, 'BBBBBB').blocks(54, 5, 'B?BB?B').coinRow(55, 7, 4);
    s.g('fallingfile', { c: 62, r: 2 }).g('fallingfile', { c: 64, r: 2 }).g('fallingfile', { c: 66, r: 2 });
    s.pipe(70, 3, true);
    s.enemy('box', 76);
    s.g('crumble', { c: 82, r: 10, n: 2 }).g('crumble', { c: 85, r: 8, n: 2 }).g('crumble', { c: 88, r: 10, n: 2 }).coinRow(85, 6, 2);
    s.checkpoint(95);
    s.enemy('virus', 103).enemy('virus', 106);
    s.g('fallingfile', { c: 110, r: 2 }).g('fallingfile', { c: 113, r: 2 });
    s.blocks(116, 8, '?S?');
    s.g('crumble', { c: 130, r: 10, n: 9 }).coinRow(130, 9, 9);
    s.enemy('box', 145).enemy('box', 147);
    s.g('fallingfile', { c: 152, r: 2 });
    s.blocks(156, 9, 'BBBBBB').blocks(156, 5, 'BBKBBB').coinRow(157, 7, 4);
    s.g('fallingfile', { c: 166, r: 2 }).g('fallingfile', { c: 168, r: 2 });
    s.enemy('virus', 172);
    s.g('crumble', { c: 178, r: 10, n: 2 }).g('crumble', { c: 182, r: 10, n: 2 });
    s.stairs(192, 5).column(197, 5);
    s.goalAt(208);
    return s;
  }

  // 4-2：ガシャンと降りるシュレッダーの列をすり抜ける ／ 招き猫で賞与 2 倍
  function stage4_2() {
    const s = stage({
      id: '4-2', name: '経理部フロア', theme: 'accounting', w: 209, time: 160,
      memo: '業務連絡：経費精算の締め切りは本日の定時です。シュレッダーが上がっているあいだに通り抜けてください。',
    });
    s.ground(0, 60).ground(64, 120).ground(125, 170).ground(174, 208);
    s.blocks(8, 8, 'C?M?C');
    s.enemy('box', 14).enemy('box', 16);
    s.g('shredder', { c: 21, r0: 3, r1: 12 }).g('shredder', { c: 26, r0: 3, r1: 12, off: 1.6 });
    s.item('maneki', 31, 10);
    s.coinRow(33, 9, 8).coinRow(33, 7, 8);
    s.blocks(42, 8, 'CBC');
    s.enemy('virus', 47);
    s.g('shredder', { c: 51, r0: 3, r1: 12, period: 2.6 }).g('shredder', { c: 55, r0: 3, r1: 12, period: 2.6, off: 1.3 });
    s.coinRow(61, 8, 3);
    s.stairs(66, 3).semi(70, 7, 12).coinRow(70, 6, 12);
    s.g('shredder', { c: 73, r0: 1, r1: 7, period: 2.8 }).g('shredder', { c: 78, r0: 1, r1: 7, period: 2.8, off: 1.4 });
    s.enemy('box', 74).enemy('box', 77);
    s.enemy('spam', 86, 6);
    s.checkpoint(88);
    s.blocks(96, 8, 'B?B?B');
    s.g('shredder', { c: 102, r0: 3, r1: 12, period: 3 }).g('shredder', { c: 105, r0: 3, r1: 12, period: 3, off: 1 }).g('shredder', { c: 108, r0: 3, r1: 12, period: 3, off: 2 });
    s.item('maneki', 113, 10);
    s.coinRow(115, 9, 5);
    s.coinRow(121, 8, 4);
    s.blocks(128, 8, 'CCC');
    s.enemy('virus', 133).enemy('virus', 136);
    s.pipe(140, 3, true);
    s.g('shredder', { c: 146, r0: 3, r1: 12, period: 2.4 });
    s.semi(150, 9, 3).semi(154, 7, 3).coinRow(154, 6, 3);
    s.enemy('box', 160).enemy('box', 162);
    s.g('shredder', { c: 165, r0: 3, r1: 12, period: 2.8, off: 0.5 });
    s.coinRow(171, 8, 3);
    s.stairs(178, 8).column(186, 8);
    s.goalAt(197);
    return s;
  }

  // 4-3：ビルとビルのあいだを観覧車ゴンドラで渡る。屋上ではときどき突風
  function stage4_3() {
    const s = stage({
      id: '4-3', name: '高層ビルの屋上', theme: 'skyscraper', w: 214, time: 180,
      memo: '業務連絡：非常階段は点検中です。屋上の観覧車ゴンドラの屋根に乗って、隣のビルへ渡ってください。突風に注意。',
    });
    s.ground(0, 28).ground(44, 70).ground(90, 116).ground(136, 160).ground(178, 213);
    s.blocks(7, 8, '?M?');
    s.enemy('box', 13);
    s.g('gust', { c1: 4, c2: 28, power: 170 });
    s.g('wheel', { c: 36, r: 7, rad: 4, n: 4 }).coinRow(35, 2, 3);
    s.g('gust', { c1: 44, c2: 70, power: 170, off: 2 });
    s.enemy('virus', 50).enemy('box', 54);
    s.blocks(58, 8, 'B?B');
    s.wall(64, 3, 2);
    s.g('wheel', { c: 80, r: 6, rad: 5, n: 5, speed: 0.4 }).coinRow(78, 1, 5);
    s.checkpoint(93);
    s.g('gust', { c1: 90, c2: 116, power: 180, off: 4 });
    s.enemy('spam', 101, 6).enemy('box', 104);
    s.blocks(107, 8, '?S?');
    s.g('wheel', { c: 126, r: 6, rad: 5, n: 4, speed: 0.5 }).coinRow(124, 1, 5);
    s.g('gust', { c1: 136, c2: 160, power: 180, off: 1 });
    s.enemy('virus', 142).enemy('virus', 146);
    s.wall(151, 4, 2).coinRow(151, 7, 2);
    s.g('wheel', { c: 169, r: 7, rad: 4, n: 4, speed: 0.55 }).coinRow(168, 2, 3);
    s.g('gust', { c1: 178, c2: 213, power: 150, off: 3 });
    s.stairs(184, 6).column(190, 6);
    s.goalAt(201);
    return s;
  }

  // 4-4：銀杏並木の長い一本道。落ちてくる銀杏で足止めされる ／ スケボー（締め切りも追ってくる）
  function stage4_4() {
    const s = stage({
      id: '4-4', name: '銀杏並木の帰り道', theme: 'autumn_street', w: 226, time: 160, chaser: true,
      memo: '業務連絡：上期の締め切りが追いかけてきます。銀杏の実に当たると、くさくて少し動けません。',
    });
    s.ground(0, 44).ground(48, 92).ground(97, 140).ground(145, 186).ground(190, 225);
    s.blocks(8, 8, '?M?');
    s.item('board', 12, 10);
    s.enemy('box', 18).enemy('box', 20);
    s.g('ginkgo', { c: 24 }).g('ginkgo', { c: 31 });
    s.enemy('virus', 35).enemy('spam', 40, 7);
    s.coinRow(45, 8, 3);
    s.blocks(52, 8, 'B?B?B');
    s.g('ginkgo', { c: 58 }).g('ginkgo', { c: 65 });
    s.enemy('box', 62).enemy('box', 69);
    s.pipe(74, 3, true);
    s.semi(79, 9, 3).semi(83, 7, 3).coinRow(83, 6, 3);
    s.enemy('spam', 88, 6);
    s.coinRow(93, 8, 4);
    s.checkpoint(100);
    s.item('board', 107, 10);
    s.g('ginkgo', { c: 112 }).g('ginkgo', { c: 119 }).g('ginkgo', { c: 126 });
    s.enemy('box', 115).enemy('virus', 122).enemy('box', 129);
    s.blocks(133, 8, '?S?');
    s.coinRow(141, 8, 4);
    s.checkpoint(148);
    s.g('ginkgo', { c: 156 }).g('ginkgo', { c: 163 });
    s.enemy('virus', 159).enemy('spam', 166, 6);
    s.pipe(170, 4);
    s.blocks(176, 8, 'BHB');
    s.enemy('box', 181);
    s.coinRow(187, 8, 3);
    s.g('ginkgo', { c: 196 });
    s.stairs(201, 8).column(209, 8);
    s.goalAt(216);
    return s;
  }

  // ================= ワールド 5：冬・年末進行 =================
  // 5-1：真っ暗なフロア。点いたり消えたりする照明の足場で穴を渡る ／ 懐中電灯
  function stage5_1() {
    const s = stage({
      id: '5-1', name: '節電フロア', theme: 'night', w: 214, time: 170, dark: true,
      memo: '業務連絡：冬の 17 時はもう真っ暗です。節電中の照明は消える前にちらつきます。懐中電灯をどうぞ。',
    });
    s.ground(0, 30).ground(44, 74).ground(90, 120).ground(136, 164).ground(180, 213);
    s.item('light', 6, 10);
    s.blocks(10, 8, '?M?');
    s.enemy('box', 16).enemy('box', 19);
    s.blocks(23, 8, 'B?B');
    s.g('blink', { c: 33, r: 10, n: 3 }).g('blink', { c: 38, r: 9, n: 3, off: 1.2 }).coinRow(38, 8, 3);
    s.enemy('virus', 50).enemy('virus', 54);
    s.semi(58, 9, 3).semi(62, 7, 3);
    s.g('blink', { c: 66, r: 5, n: 4, off: 2 }).coinRow(66, 4, 4);
    s.pipe(70, 3, true);
    s.g('blink', { c: 77, r: 10, n: 2 }).g('blink', { c: 81, r: 9, n: 2, off: 1.1 }).g('blink', { c: 85, r: 10, n: 2, off: 2.2 });
    s.checkpoint(92);
    s.enemy('box', 99).enemy('spam', 104, 6);
    s.blocks(108, 8, '?S?');
    s.enemy('virus', 113);
    s.g('blink', { c: 123, r: 10, n: 3 }).g('blink', { c: 128, r: 10, n: 2, off: 1.8 }).g('blink', { c: 132, r: 9, n: 2, off: 0.9 });
    s.enemy('box', 141).enemy('box', 143);
    s.blocks(147, 9, 'BBBBBB').blocks(147, 5, 'B?BBHB').coinRow(148, 7, 4);
    s.enemy('virus', 158);
    s.g('blink', { c: 167, r: 10, n: 2, off: 0.3 }).g('blink', { c: 171, r: 8, n: 2, off: 1.4 }).g('blink', { c: 175, r: 10, n: 2, off: 2.5 });
    s.stairs(186, 6).column(192, 6);
    s.goalAt(203);
    return s;
  }

  // 5-2：赤と青が交互に実体化するブレーカーブロックと、壁の向こうへ移る内線転送ドア
  function stage5_2() {
    const s = stage({
      id: '5-2', name: '年末メンテのサーバールーム', theme: 'server', w: 222, time: 180,
      memo: '業務連絡：年末メンテナンス中。赤と青のブロックは交互に電源が入ります。行き止まりは内線転送ドアへ。',
    });
    s.ground(0, 34).ground(44, 82).ground(92, 130).ground(140, 182).ground(192, 221);
    s.ceiling(4, 210);
    s.blocks(8, 8, '?M?');
    s.enemy('virus', 14).enemy('virus', 17);
    s.g('breaker', { c: 22, r: 8, n: 3, grp: 0 }).g('breaker', { c: 26, r: 8, n: 3, grp: 1 }).coinRow(22, 7, 7);
    s.g('breaker', { c: 36, r: 11, n: 3, grp: 0 }).g('breaker', { c: 40, r: 11, n: 3, grp: 1 });
    s.enemy('box', 50).enemy('box', 52);
    s.g('portal', { c: 57, to: [64] }).wall(60, 10, 2);
    s.blocks(66, 8, 'B?B');
    s.enemy('virus', 70).enemy('virus', 73);
    s.pipe(77, 3, true);
    s.g('breaker', { c: 84, r: 10, n: 2, grp: 0 }).g('breaker', { c: 87, r: 9, n: 2, grp: 1 }).g('breaker', { c: 90, r: 10, n: 1, grp: 0 });
    s.checkpoint(94);
    s.enemy('virus', 102).enemy('box', 105);
    s.g('portal', { c: 109, to: [116, 5] }).wall(113, 6, 6).coinRow(114, 4, 4);
    s.blocks(122, 8, '?S?');
    s.enemy('virus', 126);
    s.g('breaker', { c: 132, r: 10, n: 2, grp: 0 }).g('breaker', { c: 135, r: 10, n: 2, grp: 1 }).g('breaker', { c: 138, r: 10, n: 1, grp: 0 });
    s.enemy('box', 145).enemy('virus', 149);
    s.breakerWall(155, 6, 0).breakerWall(160, 6, 1).coinRow(156, 10, 4);
    s.g('portal', { c: 167, to: [176, 4] }).wall(173, 7, 9);
    s.g('breaker', { c: 184, r: 6, n: 2, grp: 0 }).g('breaker', { c: 188, r: 7, n: 2, grp: 1 });
    s.enemy('box', 200);
    s.goalAt(210);
    return s;
  }

  // 5-3：凍った段々と歩道。坂の上から雪玉が転がってくる
  function stage5_3() {
    const s = stage({
      id: '5-3', name: '忘年会へ続く道', theme: 'winter_street', w: 216, time: 170,
      memo: '業務連絡：忘年会の二次会への参加は任意です（本当に）。凍った道はよく滑ります。雪玉は上から踏めます。',
    });
    s.ground(0, 51).ground(56, 109).ground(114, 167).ground(172, 215);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 12);
    s.g('ice', { c: 16, n: 30 }).g('snowball', { from: 49, to: 15, period: 4.5 });
    s.coinRow(20, 9, 4).coinRow(34, 9, 4);
    s.enemy('spam', 30, 7);
    s.coinRow(52, 8, 4);
    s.wall(58, 1, 2).wall(60, 2, 2).wall(62, 3, 2).wall(64, 4, 4).wall(68, 3, 2).wall(70, 2, 2).wall(72, 1, 2);
    s.g('ice', { c: 58, n: 2, r: 11 }).g('ice', { c: 60, n: 2, r: 10 }).g('ice', { c: 62, n: 2, r: 9 }).g('ice', { c: 64, n: 4, r: 8 });
    s.g('ice', { c: 68, n: 2, r: 9 }).g('ice', { c: 70, n: 2, r: 10 }).g('ice', { c: 72, n: 2, r: 11 });
    s.enemy('box', 66, 7).coinRow(64, 6, 4);
    s.checkpoint(75);
    s.blocks(76, 8, 'B?B');
    s.g('ice', { c: 82, n: 27 }).g('snowball', { from: 108, to: 83, period: 4, speed: 170 }).g('snowball', { from: 108, to: 83, period: 4, speed: 170, off: 2 });
    s.semi(86, 9, 3).semi(93, 9, 3).semi(100, 9, 3).coinRow(86, 8, 3).coinRow(93, 8, 3).coinRow(100, 8, 3);
    s.coinRow(110, 8, 4);
    s.enemy('virus', 118).enemy('virus', 121);
    s.pipe(125, 3, true);
    s.stairs(130, 6).wall(136, 6, 6).g('ice', { c: 136, n: 6, r: 6 }).coinRow(136, 4, 6).stairs(142, 6, -1);
    s.g('ice', { c: 148, n: 18 }).g('snowball', { from: 166, to: 148, period: 3.5 });
    s.enemy('box', 152);
    s.coinRow(168, 8, 4);
    s.blocks(176, 8, '?S?');
    s.enemy('spam', 182, 6);
    s.stairs(186, 7).column(193, 7);
    s.goalAt(204);
    return s;
  }

  // 5-4：閉店シャッターが次々に下りるアーケード ／ 年末ジャンボ宝くじ（締め切りも追ってくる）
  function stage5_4() {
    const s = stage({
      id: '5-4', name: '仕事納めの繁華街', theme: 'nightstreet', w: 226, time: 160, chaser: true,
      memo: '業務連絡：年内の締め切りが追いかけてきます。お店のシャッターが閉まる前に駆け抜けてください。',
    });
    s.ground(0, 50).ground(54, 100).ground(105, 150).ground(155, 196).ground(200, 225);
    s.blocks(8, 8, '?M?');
    s.item('lottery', 13, 10);
    s.enemy('box', 18);
    s.g('shutter', { c: 24 }).g('shutter', { c: 30, off: 1.5 }).g('shutter', { c: 36, off: 3 });
    s.enemy('spam', 42, 6).enemy('virus', 46);
    s.coinRow(51, 8, 3);
    s.blocks(58, 8, 'B?B?B');
    s.g('shutter', { c: 66, period: 4 }).g('shutter', { c: 69, period: 4, off: 0.8 }).g('shutter', { c: 72, period: 4, off: 1.6 });
    s.enemy('box', 77).enemy('box', 80);
    s.item('lottery', 85, 10);
    s.pipe(90, 3, true);
    s.enemy('spam', 96, 6);
    s.coinRow(101, 8, 4);
    s.checkpoint(108);
    s.g('shutter', { c: 117 }).g('shutter', { c: 120, off: 2.5 });
    s.enemy('virus', 125).enemy('virus', 128);
    s.blocks(132, 8, '?D?');
    s.g('shutter', { c: 138, period: 3.6 }).g('shutter', { c: 142, period: 3.6, off: 1.8 });
    s.enemy('box', 146);
    s.coinRow(151, 8, 4);
    s.checkpoint(158);
    s.item('lottery', 166, 10);
    s.g('shutter', { c: 170, period: 4.4 }).g('shutter', { c: 174, period: 4.4, off: 1.1 }).g('shutter', { c: 178, period: 4.4, off: 2.2 }).g('shutter', { c: 182, period: 4.4, off: 3.3 });
    s.enemy('spam', 188, 7);
    s.coinRow(197, 8, 3);
    s.stairs(203, 6).column(209, 6);
    s.goalAt(216);
    return s;
  }

  // ================= ワールド 6：年度末・決算 =================
  // 6-1：波打つ株価チャートのローソク足を渡り継ぐ。時間は短め ／ 目覚まし時計で延長
  function stage6_1() {
    const s = stage({
      id: '6-1', name: '決算フロア', theme: 'closing', w: 222, time: 150,
      memo: '業務連絡：決算期です。株価チャートの足場は上下に波打ちます。目覚まし時計で定時まで少し延長できます。',
    });
    s.ground(0, 30).ground(46, 70).ground(90, 112).ground(134, 156).ground(178, 221);
    s.blocks(8, 8, '?M?');
    s.item('clock', 14, 10);
    s.enemy('box', 19).enemy('box', 22);
    s.g('chart', { c: 32, r: 9, n: 4, gap: 3, amp: 1.5 }).coinRow(32, 6, 11);
    s.enemy('virus', 52).enemy('spam', 58, 6);
    s.blocks(61, 8, 'B?B');
    s.g('chart', { c: 72, r: 8, n: 6, gap: 3, amp: 2, speed: 1.4 }).coinRow(73, 4, 15);
    s.checkpoint(93);
    s.item('clock', 100, 10);
    s.enemy('box', 104).enemy('box', 106);
    s.blocks(108, 8, '?S?');
    s.g('chart', { c: 114, r: 9, n: 7, gap: 3, amp: 2.2, speed: 1.1 }).coinRow(114, 5, 19);
    s.enemy('virus', 140).enemy('virus', 143);
    s.item('clock', 147, 10);
    s.blocks(150, 8, 'BCB');
    s.g('chart', { c: 158, r: 8, n: 7, gap: 3, amp: 2.5, speed: 1.6 }).coinRow(158, 3, 19);
    s.enemy('box', 184);
    s.stairs(188, 8).column(196, 8);
    s.goalAt(207);
    return s;
  }

  // 6-2：警備レーザーの廊下。社員証は寄り道した棚の上 ／ セキュリティゲート
  function stage6_2() {
    const s = stage({
      id: '6-2', name: '地下の機密書庫', theme: 'vault', w: 222, time: 180,
      memo: '業務連絡：機密書庫はセキュリティゲートで仕切られています。社員証を忘れずに。レーザーは消えている間に。',
    });
    s.ground(0, 69).ground(74, 149).ground(154, 221);
    s.ceiling(4, 210);
    s.blocks(8, 8, '?M?');
    s.enemy('virus', 13);
    s.g('laser', { c: 18, r0: 2, r1: 12 }).g('laser', { c: 23, r0: 2, r1: 12, off: 1.5 });
    s.enemy('box', 27);
    s.stairs(30, 4).semi(34, 8, 10).coinRow(35, 7, 6).item('card', 42, 7);
    s.g('laser', { axis: 'h', c0: 34, c1: 43, r: 6, period: 2.4 });
    s.gate(48);
    s.enemy('virus', 52);
    s.g('laser', { c: 57, r0: 2, r1: 12, period: 2.6 }).g('laser', { c: 60, r0: 2, r1: 12, period: 2.6, off: 0.9 }).g('laser', { c: 63, r0: 2, r1: 12, period: 2.6, off: 1.8 });
    s.coinRow(70, 8, 4);
    s.checkpoint(76);
    s.blocks(84, 9, 'BBBBBB').blocks(84, 5, 'B?BB?B').coinRow(85, 7, 4);
    s.g('laser', { axis: 'h', c0: 84, c1: 89, r: 7, period: 3, duty: 0.6 });
    s.gate(95);
    s.enemy('box', 100).enemy('box', 102);
    s.g('laser', { c: 108, r0: 2, r1: 12, period: 2 });
    s.pipe(112, 3, true);
    s.g('laser', { c: 118, r0: 2, r1: 12, period: 3.2, duty: 0.6 });
    s.blocks(122, 8, '?S?');
    s.enemy('virus', 127).enemy('virus', 130);
    s.g('laser', { axis: 'h', c0: 134, c1: 146, r: 10, period: 2.8, duty: 0.45 });
    s.semi(136, 7, 8).coinRow(136, 6, 8);
    s.coinRow(150, 8, 4);
    s.checkpoint(157);
    s.g('laser', { c: 165, r0: 2, r1: 12, period: 2.2 }).g('laser', { c: 168, r0: 2, r1: 12, period: 2.2, off: 1.1 });
    s.gate(172);
    s.enemy('box', 177).enemy('virus', 181);
    s.blocks(185, 8, 'BHB');
    s.stairs(193, 5).column(198, 5);
    s.goalAt(210);
    return s;
  }

  // 6-3：ジャンプするたびに「承認」と「却下」のブロックが入れ替わる ／ エナジーゼリーで 2 段ジャンプ
  function stage6_3() {
    const s = stage({
      id: '6-3', name: '最上階・役員フロア', theme: 'executive', w: 216, time: 170,
      memo: '業務連絡：役員フロアのハンコブロックは、あなたがジャンプするたびに「承認」と「却下」が入れ替わります。',
    });
    s.ground(0, 30).ground(40, 76).ground(88, 120).ground(132, 164).ground(176, 215);
    s.blocks(8, 8, '?M?');
    s.item('jelly', 13, 10);
    s.enemy('box', 18).enemy('box', 21);
    s.stamp(32, 10, 2, 0).stamp(34, 10, 2, 1).stamp(37, 10, 2, 0).coinRow(32, 8, 7);
    s.enemy('virus', 45);
    s.stampWall(50, 4, 0).stampWall(56, 4, 1);
    s.enemy('box', 53);
    s.blocks(60, 8, 'B?B');
    s.stamp(64, 9, 2, 0).stamp(67, 7, 2, 1).stamp(70, 5, 2, 0).coinRow(70, 4, 2);
    s.pipe(73, 3, true);
    s.stamp(78, 10, 2, 0).stamp(80, 9, 2, 1).stamp(83, 10, 2, 0).stamp(85, 9, 2, 1);
    s.checkpoint(90);
    s.enemy('box', 97).enemy('spam', 101, 6);
    s.blocks(104, 8, '?S?');
    s.stampWall(110, 5, 1).stampWall(114, 5, 0);
    s.stamp(122, 10, 2, 1).stamp(124, 10, 2, 0).stamp(127, 9, 2, 1).stamp(129, 9, 2, 0);
    s.item('jelly', 136, 10);
    s.enemy('virus', 140).enemy('virus', 143);
    s.blocks(147, 9, 'BBBBBB').blocks(147, 5, 'B?BBCB').coinRow(148, 7, 4);
    s.stampWall(158, 5, 0);
    s.stamp(166, 10, 2, 0).stamp(168, 9, 2, 1).stamp(171, 8, 2, 0).stamp(173, 9, 2, 1);
    s.stairs(184, 6).column(190, 6);
    s.goalAt(201);
    return s;
  }

  // 6-4：大時計の振り子をかわし、ワイヤーで大穴を一気に滑り降りる（締め切りも追ってくる）
  function stage6_4() {
    const s = stage({
      id: '6-4', name: '定時ダッシュ・ファイナル', theme: 'final', w: 240, time: 170, chaser: true,
      memo: '業務連絡：年度最後の定時です。振り子をかわし、ワイヤーにつかまって大穴を越え、タイムカードを押してください。',
    });
    s.ground(0, 40).ground(44, 84).ground(110, 150).ground(154, 190).ground(214, 239);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('spam', 19, 7);
    s.g('pendulum', { c: 28, r: 2, len: 9, amp: 0.85, speed: 1.5 });
    s.coinRow(41, 8, 3);
    s.enemy('virus', 48);
    s.g('pendulum', { c: 56, r: 2, len: 9, amp: 0.85, speed: 1.5, off: 1.5 }).g('pendulum', { c: 66, r: 2, len: 9, amp: 0.85, speed: 1.5, off: 3 });
    s.spring(74).wall(76, 7, 2).coinRow(74, 2, 4);
    s.spring(80).zip(78, 4, 110, 9).coinRow(86, 5, 6).coinRow(94, 6, 6).coinRow(102, 7, 6);
    s.checkpoint(113);
    s.enemy('box', 121).enemy('box', 123);
    s.g('pendulum', { c: 132, r: 2, len: 9, amp: 0.9, speed: 1.7 });
    s.blocks(141, 8, '?S?');
    s.coinRow(151, 8, 3);
    s.g('pendulum', { c: 162, r: 2, len: 9, amp: 0.85, speed: 1.6, off: 0.8 }).g('pendulum', { c: 172, r: 2, len: 9, amp: 0.85, speed: 1.6, off: 2.4 });
    s.enemy('virus', 178);
    s.stairs(181, 6).wall(187, 6, 3);
    s.spring(190).zip(189, 5, 214, 10).coinRow(195, 6, 5).coinRow(203, 8, 5);
    s.enemy('box', 224);
    s.goalAt(230);
    return s;
  }

  // ワールド名（1 から順に）
  const WORLDS = ['いつもの一日', '春・新年度', '夏・繁忙期', '秋・監査シーズン', '冬・年末進行', '年度末・決算'];
  const list = [
    stage1, stage2, stage3,
    stage2_1, stage2_2, stage2_3, stage2_4,
    stage3_1, stage3_2, stage3_3, stage3_4,
    stage4_1, stage4_2, stage4_3, stage4_4,
    stage5_1, stage5_2, stage5_3, stage5_4,
    stage6_1, stage6_2, stage6_3, stage6_4,
  ];
  // ロビーやイントロで使う情報（一度だけ作っておく）
  const meta = list.map((f, i) => {
    const s = f();
    return { idx: i, id: s.id, name: s.name, memo: s.memo, theme: s.theme, world: Number(s.id.split('-')[0]) };
  });
  return {
    ROWS, T, WORLDS, meta,
    count: list.length,
    make: i => list[i](),
    info: i => meta[i],
    worldStages: n => meta.filter(m => m.world === n).map(m => m.idx),
  };
})();
