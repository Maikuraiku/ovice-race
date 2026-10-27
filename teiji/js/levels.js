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

  // ================= ワールド 2：春・新年度 =================
  function stage2_1() {
    const s = stage({
      id: '2-1', name: '新人研修フロア', theme: 'office', w: 210, time: 170,
      memo: '業務連絡：新入社員のみなさん、定時退社も研修の一環です。',
    });
    s.ground(0, 70).ground(74, 120).ground(125, 160).ground(164, 209);
    s.prop('plant', 1);
    s.blocks(8, 8, '?B?B?').coinRow(8, 4, 5);
    s.enemy('box', 16).enemy('box', 19);
    s.semi(23, 9, 3).semi(27, 7, 3).semi(31, 5, 3).coinRow(31, 4, 3);
    s.blocks(36, 8, 'M');
    s.enemy('virus', 40);
    s.pipe(44, 2).pipe(50, 3, true).pipe(56, 4);
    s.enemy('box', 61).coinRow(64, 8, 4);
    s.blocks(78, 8, 'BB?BB').blocks(80, 4, 'S');
    s.enemy('box', 80, 7);
    s.enemy('spam', 90, 7);
    s.checkpoint(96);
    s.semi(101, 9, 5).coinRow(101, 8, 5).enemy('box', 103, 8);
    s.blocks(109, 8, 'B?B');
    s.enemy('virus', 114).enemy('virus', 117);
    s.coinRow(121, 8, 4);
    s.blocks(130, 8, 'BCB').enemy('box', 136).enemy('box', 138);
    s.pipe(142, 3, true);
    s.semi(148, 9, 3).semi(152, 7, 3).coinRow(152, 6, 3);
    s.enemy('spam', 158, 6);
    s.stairs(170, 7).column(177, 7);
    s.goalAt(188).prop('plant', 195);
    return s;
  }

  function stage2_2() {
    const s = stage({
      id: '2-2', name: '備品倉庫', theme: 'basement', w: 220, time: 170,
      memo: '業務連絡：備品倉庫のダンボールが勝手に動いています。気のせいです。',
    });
    s.ground(0, 50).ground(54, 96).ground(100, 140).ground(146, 219);
    s.ceiling(4, 200);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('box', 16);
    s.blocks(20, 9, 'BBBBBBBBBB').blocks(20, 5, 'BBBCBBBBKB').coinRow(21, 7, 8);
    s.enemy('box', 24, 8);
    s.pipe(33, 3, true);
    s.enemy('virus', 38).enemy('virus', 42);
    s.pipe(46, 2);
    s.blocks(57, 8, 'B?B?B').enemy('box', 59, 7);
    s.stairs(65, 3).column(68, 3);
    s.enemy('virus', 73);
    s.pipe(77, 4, true);
    s.enemy('box', 83).enemy('box', 85);
    s.blocks(89, 8, 'H');
    s.checkpoint(104);
    s.blocks(108, 9, 'BBBBBB').blocks(108, 5, 'B?BB?B').coinRow(109, 7, 4);
    s.enemy('virus', 112);
    s.enemy('box', 117).enemy('box', 119);
    s.pipe(123, 3, true);
    s.semi(128, 9, 3).semi(132, 7, 3).coinRow(132, 6, 3);
    s.enemy('box', 137);
    s.lift(141, 10, 'x', 141, 143).coinRow(142, 6, 3);
    s.enemy('virus', 151);
    s.blocks(154, 8, 'B?B?B');
    s.stairs(161, 5).column(166, 5);
    s.hole(167, 169);
    s.stairs(170, 5, -1);
    s.pipe(180, 2).pipe(186, 3, true);
    s.enemy('box', 191).enemy('box', 193);
    s.goalAt(206);
    return s;
  }

  function stage2_3() {
    const s = stage({
      id: '2-3', name: 'お花見の屋上', theme: 'rooftop', w: 210, time: 170,
      memo: '業務連絡：屋上での花見の場所取りは業務ではありません。',
    });
    s.ground(0, 30).ground(35, 62).ground(67, 90).ground(98, 128).ground(133, 160).ground(168, 209);
    s.prop('plant', 2);
    s.blocks(8, 8, '?M?');
    s.semi(14, 9, 4).coinRow(14, 8, 4);
    s.enemy('box', 20).enemy('box', 22);
    s.coinRow(31, 8, 4);
    s.enemy('spam', 40, 7);
    s.blocks(44, 8, 'B?B').blocks(45, 4, '?');
    s.semi(50, 9, 3).semi(54, 7, 3).coinRow(54, 6, 3);
    s.enemy('virus', 59);
    s.coinRow(63, 8, 4);
    s.enemy('box', 72).enemy('box', 74);
    s.pipe(78, 3);
    s.blocks(83, 8, '?S?');
    s.lift(91, 10, 'x', 91, 95).coinRow(92, 6, 4);
    s.checkpoint(102);
    s.enemy('spam', 108, 6);
    s.blocks(110, 8, 'BBBBB').enemy('box', 112, 7);
    s.enemy('virus', 118).enemy('virus', 121);
    s.pipe(124, 2);
    s.coinRow(129, 8, 4);
    s.semi(136, 9, 3).semi(140, 7, 3).semi(144, 5, 3).coinRow(144, 4, 3);
    s.enemy('spam', 149, 7);
    s.blocks(152, 8, 'B?B');
    s.lift(161, 10, 'x', 161, 165).coinRow(162, 6, 4);
    s.prop('plant', 171);
    s.stairs(176, 8).column(184, 8);
    s.goalAt(195);
    return s;
  }

  function stage2_4() {
    const s = stage({
      id: '2-4', name: '桜並木の帰り道', theme: 'street', w: 212, time: 150, chaser: true,
      memo: '業務連絡：年度初めの締め切りが追いかけてきます。桜を見ている暇はありません。',
    });
    s.ground(0, 44).ground(48, 86).ground(90, 128).ground(133, 172).ground(176, 211);
    s.blocks(9, 8, '?M?');
    s.enemy('box', 16).enemy('box', 18);
    s.semi(22, 9, 3).semi(26, 7, 3).coinRow(26, 6, 3);
    s.enemy('spam', 32, 6);
    s.blocks(36, 8, 'B?B?B');
    s.enemy('virus', 41);
    s.coinRow(45, 8, 3);
    s.pipe(52, 2).pipe(57, 3, true);
    s.enemy('box', 62).enemy('box', 64).enemy('box', 66);
    s.blocks(70, 8, 'BSB');
    s.enemy('spam', 76, 7);
    s.semi(80, 9, 4);
    s.checkpoint(94);
    s.enemy('virus', 99).enemy('virus', 102);
    s.blocks(106, 8, '?B?B?').blocks(108, 4, 'H');
    s.enemy('box', 113).enemy('box', 115);
    s.pipe(119, 4);
    s.enemy('spam', 124, 5);
    s.coinRow(129, 8, 4);
    s.semi(136, 9, 3).semi(140, 7, 3).coinRow(140, 6, 3);
    s.enemy('virus', 146).enemy('box', 150).enemy('box', 152);
    s.blocks(156, 8, 'BCB');
    s.pipe(162, 3, true);
    s.enemy('spam', 168, 7);
    s.coinRow(173, 8, 3);
    s.stairs(181, 8).column(189, 8);
    s.goalAt(200);
    return s;
  }

  // ================= ワールド 3：夏・繁忙期 =================
  function stage3_1() {
    const s = stage({
      id: '3-1', name: '冷房の効かないフロア', theme: 'office', w: 212, time: 160,
      memo: '業務連絡：節電のため冷房は 28 度設定です。走ると暑いです。',
    });
    s.ground(0, 52).ground(56, 100).ground(105, 150).ground(155, 211);
    s.blocks(8, 8, '?B?');
    s.enemy('box', 14).enemy('box', 16).enemy('virus', 20);
    s.pipe(24, 3, true);
    s.blocks(30, 8, 'BBBBBBBB').blocks(30, 4, 'B?BMB?BB');
    s.enemy('box', 33, 7).enemy('box', 36, 7);
    s.enemy('spam', 42, 6);
    s.semi(45, 9, 3).coinRow(45, 8, 3);
    s.enemy('virus', 50);
    s.coinRow(53, 8, 3);
    s.pipe(60, 2).pipe(65, 3).pipe(70, 4, true);
    s.enemy('box', 75).enemy('box', 77).enemy('box', 79);
    s.blocks(83, 8, '?S?');
    s.enemy('spam', 90, 7);
    s.enemy('virus', 94).enemy('virus', 97);
    s.coinRow(101, 8, 4);
    s.checkpoint(106);
    s.stairs(113, 4).semi(117, 8, 8).coinRow(117, 7, 8).enemy('box', 121, 7);
    s.enemy('box', 120);
    s.enemy('virus', 128);
    s.blocks(132, 8, 'BCB');
    s.enemy('spam', 138, 6);
    s.pipe(143, 3, true);
    s.coinRow(151, 8, 4);
    s.semi(158, 9, 3).semi(162, 7, 3).semi(166, 5, 3).coinRow(166, 4, 3);
    s.enemy('box', 170).enemy('box', 172);
    s.blocks(175, 8, 'H');
    s.stairs(180, 8).column(188, 8);
    s.goalAt(199);
    return s;
  }

  function stage3_2() {
    const s = stage({
      id: '3-2', name: '熱暴走サーバールーム', theme: 'server', w: 218, time: 170,
      memo: '業務連絡：サーバーが熱暴走しています。ウイルスにも注意してください。',
    });
    s.ground(0, 40).ground(44, 82).ground(86, 120).ground(128, 166).ground(170, 217);
    s.ceiling(4, 196);
    s.blocks(8, 8, '?M?');
    s.enemy('virus', 14).enemy('virus', 17).enemy('virus', 20);
    s.pipe(25, 3, true);
    s.blocks(30, 9, 'BBBBBBBB').blocks(30, 5, 'B?BBBB?B').coinRow(31, 7, 6);
    s.enemy('virus', 33, 8);
    s.coinRow(41, 8, 3);
    s.pipe(47, 2, true);
    s.enemy('virus', 52).enemy('virus', 55);
    s.blocks(59, 8, 'BBSBB').enemy('box', 61, 7);
    s.pipe(67, 4, true);
    s.enemy('virus', 72).enemy('box', 75).enemy('box', 77);
    s.coinRow(83, 8, 3);
    s.checkpoint(90);
    s.blocks(94, 8, '?B?B?');
    s.enemy('virus', 97).enemy('virus', 100).enemy('virus', 103);
    s.pipe(107, 3, true);
    s.semi(112, 9, 3).coinRow(112, 8, 3);
    s.enemy('box', 117);
    s.lift(121, 10, 'x', 121, 125).coinRow(122, 6, 4);
    s.enemy('virus', 132).enemy('virus', 135);
    s.blocks(139, 9, 'BBBBBB').blocks(139, 5, 'BBKBBB').coinRow(140, 7, 4);
    s.enemy('box', 141, 8);
    s.pipe(149, 3, true);
    s.enemy('virus', 154);
    s.stairs(161, 5).column(166, 5);
    s.stairs(170, 5, -1);
    s.pipe(180, 2).pipe(185, 3, true);
    s.enemy('virus', 190);
    s.goalAt(205);
    return s;
  }

  function stage3_3() {
    const s = stage({
      id: '3-3', name: '炎天下の屋上', theme: 'rooftop', w: 212, time: 160,
      memo: '業務連絡：屋上のビアガーデンは 18 時開店です。ゴンドラで急いでください。',
    });
    s.ground(0, 28).ground(33, 55).ground(62, 84).ground(89, 112).ground(120, 140).ground(145, 168).ground(175, 211);
    s.blocks(7, 8, '?M?');
    s.enemy('box', 14).enemy('box', 16);
    s.semi(19, 9, 3).semi(23, 7, 3).coinRow(23, 6, 3);
    s.coinRow(29, 8, 4);
    s.enemy('spam', 36, 7);
    s.blocks(40, 8, 'B?B');
    s.enemy('virus', 45);
    s.pipe(50, 3);
    s.lift(56, 10, 'x', 56, 59).coinRow(57, 6, 4);
    s.enemy('box', 66).enemy('box', 68);
    s.semi(71, 9, 4).enemy('box', 73, 8);
    s.enemy('spam', 79, 6);
    s.coinRow(85, 8, 4);
    s.checkpoint(92);
    s.blocks(97, 8, '?S?');
    s.enemy('virus', 102).enemy('virus', 105);
    s.pipe(108, 2);
    s.lift(114, 11, 'y', 7, 11).lift(117, 7, 'y', 7, 11, 1.3).coinRow(114, 5, 5);
    s.enemy('spam', 124, 7);
    s.semi(126, 9, 3).semi(130, 7, 3).semi(134, 5, 3).coinRow(134, 4, 3);
    s.enemy('box', 137);
    s.coinRow(141, 8, 4);
    s.blocks(149, 8, 'BBCBB').enemy('box', 151, 7);
    s.enemy('virus', 157).enemy('virus', 160);
    s.pipe(163, 3, true);
    s.lift(169, 10, 'x', 169, 172).coinRow(170, 6, 4);
    s.stairs(181, 8).column(189, 8);
    s.goalAt(200);
    return s;
  }

  function stage3_4() {
    const s = stage({
      id: '3-4', name: '夏祭りの商店街', theme: 'street', w: 207, time: 150, chaser: true,
      memo: '業務連絡：お盆前の締め切りが追いかけてきます。屋台に寄り道しないでください。',
    });
    s.ground(0, 38).ground(42, 80).ground(85, 118).ground(122, 160).ground(165, 206);
    s.blocks(8, 8, '?M?');
    s.semi(14, 9, 3).semi(18, 7, 3).semi(22, 9, 3).coinRow(18, 6, 3);
    s.enemy('box', 27).enemy('box', 29).enemy('spam', 33, 7);
    s.coinRow(39, 8, 3);
    s.blocks(45, 8, 'B?B?B').blocks(47, 4, 'S');
    s.enemy('virus', 51).enemy('virus', 54);
    s.pipe(57, 3, true);
    s.enemy('spam', 62, 5).enemy('spam', 66, 8);
    s.semi(70, 9, 4).enemy('virus', 72, 8);
    s.enemy('box', 77);
    s.coinRow(81, 8, 4);
    s.checkpoint(90);
    s.enemy('box', 94).enemy('box', 96).enemy('box', 98);
    s.blocks(102, 8, '?D?');
    s.enemy('spam', 108, 6);
    s.pipe(112, 2).enemy('virus', 116);
    s.coinRow(119, 8, 3);
    s.blocks(125, 8, 'BBCBB').blocks(126, 4, 'H');
    s.enemy('virus', 131).enemy('virus', 134);
    s.semi(137, 9, 3).semi(141, 7, 3).semi(145, 5, 3).coinRow(145, 4, 3);
    s.enemy('spam', 150, 7);
    s.pipe(154, 4, true);
    s.coinRow(161, 8, 4);
    s.enemy('box', 168).enemy('box', 170);
    s.stairs(176, 8).column(184, 8);
    s.goalAt(195);
    return s;
  }

  // ================= ワールド 4：秋・監査シーズン =================
  function stage4_1() {
    const s = stage({
      id: '4-1', name: '監査前の書庫', theme: 'basement', w: 220, time: 170,
      memo: '業務連絡：明日は監査です。鳴っている黒電話はたぶん監査法人です。',
    });
    s.ground(0, 36).ground(40, 74).ground(78, 112).ground(117, 150).ground(158, 219);
    s.ceiling(4, 206);
    s.blocks(8, 8, '?M?');
    s.pipe(14, 3, true).pipe(19, 2, true);
    s.enemy('box', 24).enemy('box', 26);
    s.blocks(29, 9, 'BBBBBB').blocks(29, 5, 'BCBB?B').coinRow(30, 7, 4);
    s.coinRow(37, 8, 3);
    s.enemy('virus', 44).enemy('virus', 47);
    s.pipe(51, 4, true);
    s.blocks(57, 8, 'B?B?B').enemy('box', 59, 7);
    s.enemy('box', 63).enemy('box', 65);
    s.pipe(69, 3, true);
    s.coinRow(75, 8, 3);
    s.checkpoint(79);
    s.stairs(86, 3).semi(89, 9, 6).coinRow(89, 8, 6).enemy('box', 91, 8);
    s.enemy('virus', 96);
    s.pipe(100, 3, true);
    s.blocks(105, 8, '?S?');
    s.enemy('virus', 109).enemy('box', 111);
    s.coinRow(113, 8, 4);
    s.blocks(120, 9, 'BBBBBBBB').blocks(120, 5, 'BBBKBBBB').coinRow(121, 7, 6);
    s.enemy('box', 122, 8).enemy('box', 125, 8);
    s.pipe(131, 2, true).pipe(136, 3, true).pipe(141, 4, true);
    s.enemy('virus', 147);
    s.lift(151, 10, 'x', 151, 155).coinRow(152, 6, 4);
    s.blocks(162, 8, 'H');
    s.enemy('box', 166).enemy('box', 168);
    s.stairs(172, 5).column(177, 5);
    s.hole(178, 180);
    s.stairs(181, 5, -1);
    s.pipe(190, 3, true);
    s.goalAt(208);
    return s;
  }

  function stage4_2() {
    const s = stage({
      id: '4-2', name: '経理部フロア', theme: 'office', w: 204, time: 160,
      memo: '業務連絡：経費精算の締め切りは本日の定時です。領収書の山に注意してください。',
    });
    s.ground(0, 45).ground(49, 92).ground(97, 140).ground(145, 203);
    s.blocks(8, 8, 'C?M?C');
    s.enemy('box', 15).enemy('box', 17).enemy('box', 19);
    s.semi(23, 9, 3).semi(27, 7, 3).semi(31, 5, 3).coinRow(31, 4, 3);
    s.enemy('spam', 35, 8).enemy('spam', 39, 5);
    s.pipe(41, 3, true);
    s.coinRow(46, 8, 3);
    s.blocks(52, 8, 'BBBBBBB').blocks(52, 4, 'B?BCB?B');
    s.enemy('box', 54, 7).enemy('box', 57, 7);
    s.enemy('virus', 62).enemy('virus', 65);
    s.pipe(69, 2).pipe(74, 4);
    s.enemy('spam', 80, 6);
    s.blocks(84, 8, '?S?');
    s.enemy('box', 88).enemy('box', 90);
    s.coinRow(93, 8, 4);
    s.checkpoint(99);
    s.lift(103, 11, 'y', 5, 11).semi(106, 5, 8).coinRow(106, 4, 8);
    s.enemy('virus', 108).enemy('virus', 112);
    s.blocks(116, 8, 'B?B?B');
    s.enemy('box', 121).enemy('box', 123).enemy('box', 125);
    s.pipe(129, 3, true);
    s.enemy('spam', 135, 7);
    s.coinRow(141, 8, 4);
    s.semi(148, 9, 4).enemy('box', 150, 8);
    s.blocks(155, 8, 'BHB');
    s.enemy('virus', 160).enemy('virus', 163);
    s.pipe(167, 3, true);
    s.stairs(173, 8).column(181, 8);
    s.goalAt(192);
    return s;
  }

  function stage4_3() {
    const s = stage({
      id: '4-3', name: '高層ビルの屋上', theme: 'rooftop', w: 209, time: 170,
      memo: '業務連絡：非常階段は点検中です。広いすき間はダッシュで跳び越えてください。',
    });
    s.ground(0, 25).ground(30, 48).ground(56, 72).ground(77, 95).ground(103, 118).ground(124, 142).ground(150, 165).ground(171, 208);
    s.blocks(7, 8, '?M?');
    s.enemy('box', 14).enemy('spam', 20, 7);
    s.coinRow(26, 8, 4);
    s.semi(33, 9, 3).semi(37, 7, 3).coinRow(37, 6, 3);
    s.enemy('virus', 44);
    s.lift(49, 10, 'x', 49, 53).coinRow(50, 6, 4);
    s.enemy('box', 60).enemy('box', 62);
    s.blocks(65, 8, 'B?B');
    s.enemy('spam', 70, 6);
    s.coinRow(73, 8, 4);
    s.checkpoint(77);
    s.pipe(83, 3);
    s.enemy('virus', 88).enemy('virus', 91);
    s.lift(97, 11, 'y', 6, 11).lift(100, 6, 'y', 6, 11, 1.2).coinRow(98, 4, 4);
    s.enemy('box', 107).enemy('box', 109);
    s.blocks(112, 8, '?S?');
    s.coinRow(119, 8, 5);
    s.semi(127, 9, 3).semi(131, 7, 3).semi(135, 5, 3).coinRow(135, 4, 3);
    s.enemy('spam', 139, 6);
    s.lift(143, 10, 'x', 143, 147).coinRow(144, 6, 4);
    s.enemy('virus', 154).enemy('virus', 157);
    s.pipe(160, 2);
    s.coinRow(166, 8, 5);
    s.stairs(178, 8).column(186, 8);
    s.goalAt(197);
    return s;
  }

  function stage4_4() {
    const s = stage({
      id: '4-4', name: '紅葉の並木道', theme: 'street', w: 236, time: 160, chaser: true,
      memo: '業務連絡：上期の締め切りが追いかけてきます。紅葉狩りは週末にどうぞ。',
    });
    s.ground(0, 40).ground(44, 78).ground(83, 116).ground(121, 156).ground(160, 196).ground(200, 235);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 15).enemy('box', 17).enemy('spam', 22, 6);
    s.pipe(26, 3, true);
    s.semi(31, 9, 3).semi(35, 7, 3).coinRow(35, 6, 3);
    s.enemy('virus', 39);
    s.coinRow(41, 8, 3);
    s.blocks(47, 8, 'B?B?B').enemy('box', 49, 7);
    s.enemy('spam', 55, 5).enemy('spam', 59, 8);
    s.enemy('virus', 63).enemy('virus', 66);
    s.pipe(70, 4);
    s.enemy('box', 75);
    s.coinRow(79, 8, 4);
    s.checkpoint(88);
    s.blocks(92, 8, '?S?').blocks(93, 4, 'H');
    s.enemy('box', 97).enemy('box', 99).enemy('box', 101);
    s.semi(105, 9, 4).enemy('virus', 107, 8);
    s.enemy('spam', 112, 6);
    s.coinRow(117, 8, 4);
    s.pipe(125, 3, true);
    s.enemy('virus', 131).enemy('virus', 134);
    s.blocks(138, 8, 'BBCBB');
    s.enemy('spam', 145, 7).enemy('box', 149).enemy('box', 151);
    s.coinRow(157, 8, 3);
    s.checkpoint(163);
    s.semi(166, 9, 3).semi(170, 7, 3).semi(174, 5, 3).coinRow(174, 4, 3);
    s.enemy('box', 179).enemy('virus', 183);
    s.pipe(188, 3, true);
    s.enemy('spam', 193, 7);
    s.coinRow(197, 8, 3);
    s.stairs(205, 8).column(213, 8);
    s.goalAt(224);
    return s;
  }

  // ================= ワールド 5：冬・年末進行 =================
  function stage5_1() {
    const s = stage({
      id: '5-1', name: '節電フロア', theme: 'night', w: 203, time: 160,
      memo: '業務連絡：冬の 17 時はもう真っ暗です。節電のため照明は半分です。',
    });
    s.ground(0, 48).ground(52, 96).ground(101, 146).ground(151, 202);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('box', 16).enemy('box', 18);
    s.pipe(22, 3, true);
    s.blocks(28, 8, 'BBBBB').blocks(28, 4, 'B?B?B').enemy('box', 30, 7);
    s.enemy('spam', 36, 6);
    s.enemy('virus', 40).enemy('virus', 43);
    s.coinRow(49, 8, 3);
    s.stairs(55, 4).column(59, 4).column(60, 4).stairs(61, 4, -1);
    s.enemy('box', 68).enemy('box', 70);
    s.lift(74, 11, 'y', 6, 11).semi(77, 6, 6).coinRow(77, 5, 6);
    s.enemy('virus', 78).enemy('virus', 81);
    s.pipe(86, 4, true);
    s.enemy('spam', 92, 7);
    s.coinRow(97, 8, 4);
    s.checkpoint(104);
    s.blocks(108, 8, '?B?B?').blocks(110, 4, 'S');
    s.enemy('box', 109, 7).enemy('box', 111, 7);
    s.enemy('virus', 116).enemy('virus', 119).enemy('virus', 122);
    s.semi(126, 9, 3).semi(130, 7, 3).semi(134, 9, 3).coinRow(130, 6, 3);
    s.enemy('spam', 139, 7);
    s.pipe(142, 3, true);
    s.coinRow(147, 8, 4);
    s.enemy('box', 155).enemy('box', 157).enemy('box', 159);
    s.blocks(163, 8, 'BHB');
    s.enemy('virus', 167);
    s.stairs(172, 8).column(180, 8);
    s.goalAt(191);
    return s;
  }

  function stage5_2() {
    const s = stage({
      id: '5-2', name: '年末メンテのサーバールーム', theme: 'server', w: 238, time: 180,
      memo: '業務連絡：年末メンテナンス中です。ウイルスを持ち込まないでください。',
    });
    s.ground(0, 34).ground(38, 70).ground(74, 104).ground(112, 146).ground(150, 180).ground(188, 237);
    s.ceiling(4, 216);
    s.blocks(8, 8, '?M?');
    s.enemy('virus', 14).enemy('virus', 17);
    s.pipe(21, 3, true);
    s.blocks(26, 9, 'BBBBBB').blocks(26, 5, 'B?BB?B').coinRow(27, 7, 4).enemy('virus', 28, 8);
    s.coinRow(35, 8, 3);
    s.enemy('virus', 42).enemy('virus', 45).enemy('virus', 48);
    s.pipe(52, 4, true);
    s.blocks(58, 8, 'BBSBB').enemy('box', 60, 7);
    s.enemy('virus', 65);
    s.coinRow(71, 8, 3);
    s.pipe(77, 2, true).pipe(82, 3, true);
    s.enemy('box', 87).enemy('box', 89).enemy('virus', 93);
    s.blocks(97, 8, '?B?');
    s.enemy('virus', 101);
    s.lift(105, 10, 'x', 105, 109).coinRow(106, 6, 4);
    s.checkpoint(116);
    s.blocks(120, 9, 'BBBBBBBB').blocks(120, 5, 'BKBBBB?B').coinRow(121, 7, 6);
    s.enemy('virus', 122, 8).enemy('virus', 126, 8);
    s.pipe(131, 3, true);
    s.enemy('virus', 136).enemy('virus', 139).enemy('virus', 142);
    s.coinRow(147, 8, 3);
    s.stairs(153, 4).semi(157, 8, 5).coinRow(157, 7, 5).enemy('box', 159, 7);
    s.enemy('virus', 164);
    s.pipe(168, 3, true);
    s.blocks(173, 8, 'B?B');
    s.enemy('virus', 177);
    s.lift(182, 11, 'y', 6, 11).lift(185, 6, 'y', 6, 11, 1.2).coinRow(183, 4, 4);
    s.stairs(195, 5).column(200, 5);
    s.hole(201, 203);
    s.stairs(204, 5, -1);
    s.enemy('virus', 212).enemy('box', 215);
    s.goalAt(226);
    return s;
  }

  function stage5_3() {
    const s = stage({
      id: '5-3', name: '忘年会へ続く道', theme: 'nightstreet', w: 216, time: 170,
      memo: '業務連絡：忘年会の二次会への参加は任意です（本当に）。',
    });
    s.ground(0, 42).ground(46, 84).ground(89, 124).ground(129, 166).ground(171, 215);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('box', 16).enemy('spam', 20, 7);
    s.semi(24, 9, 3).semi(28, 7, 3).semi(32, 5, 3).coinRow(32, 4, 3);
    s.enemy('virus', 36).enemy('virus', 39);
    s.coinRow(43, 8, 3);
    s.blocks(49, 8, 'BB?BB').blocks(51, 4, 'S').enemy('box', 50, 7);
    s.enemy('spam', 57, 6).enemy('spam', 61, 8);
    s.pipe(65, 3, true);
    s.enemy('box', 70).enemy('box', 72).enemy('box', 74);
    s.blocks(78, 8, '?C?');
    s.coinRow(85, 8, 4);
    s.checkpoint(93);
    s.enemy('virus', 97).enemy('virus', 100);
    s.lift(104, 11, 'y', 6, 11).semi(107, 6, 5).coinRow(107, 5, 5);
    s.enemy('box', 108).enemy('box', 110);
    s.pipe(116, 4, true);
    s.enemy('spam', 121, 6);
    s.coinRow(125, 8, 4);
    s.blocks(132, 8, 'B?B?B').enemy('box', 134, 7);
    s.enemy('virus', 139).enemy('virus', 142).enemy('virus', 145);
    s.semi(149, 9, 3).semi(153, 7, 3).coinRow(153, 6, 3);
    s.enemy('spam', 158, 6);
    s.pipe(162, 3, true);
    s.coinRow(167, 8, 4);
    s.enemy('box', 175).enemy('box', 177);
    s.blocks(180, 8, 'H');
    s.stairs(185, 8).column(193, 8);
    s.goalAt(204);
    return s;
  }

  function stage5_4() {
    const s = stage({
      id: '5-4', name: '仕事納めの繁華街', theme: 'nightstreet', w: 230, time: 160, chaser: true,
      memo: '業務連絡：年内の締め切りが追いかけてきます。今日は仕事納めです。逃げ切ってください。',
    });
    s.ground(0, 36).ground(40, 72).ground(77, 108).ground(113, 146).ground(151, 186).ground(191, 229);
    s.blocks(8, 8, '?M?');
    s.enemy('spam', 15, 7).enemy('box', 18).enemy('box', 20);
    s.pipe(24, 3, true);
    s.semi(29, 9, 3).coinRow(29, 8, 3);
    s.enemy('virus', 33);
    s.coinRow(37, 8, 3);
    s.blocks(43, 8, 'B?B?B').blocks(45, 4, 'S').enemy('box', 45, 7);
    s.enemy('spam', 52, 5).enemy('spam', 55, 8);
    s.enemy('virus', 59).enemy('virus', 62);
    s.pipe(66, 4, true);
    s.coinRow(73, 8, 4);
    s.checkpoint(81);
    s.enemy('box', 84).enemy('box', 86).enemy('box', 88);
    s.semi(91, 9, 3).semi(95, 7, 3).semi(99, 5, 3).coinRow(99, 4, 3);
    s.enemy('spam', 103, 7);
    s.coinRow(109, 8, 4);
    s.blocks(116, 8, '?D?');
    s.enemy('virus', 120).enemy('virus', 123).enemy('virus', 126);
    s.pipe(130, 3, true);
    s.enemy('spam', 136, 6);
    s.blocks(140, 8, 'BCB').enemy('box', 143);
    s.coinRow(147, 8, 4);
    s.checkpoint(156);
    s.enemy('box', 159).enemy('box', 161).enemy('virus', 165);
    s.blocks(169, 8, 'BHB');
    s.pipe(174, 2).pipe(179, 4, true);
    s.enemy('spam', 184, 7);
    s.coinRow(187, 8, 4);
    s.enemy('virus', 195);
    s.stairs(199, 8).column(207, 8);
    s.goalAt(218);
    return s;
  }

  // ================= ワールド 6：年度末・決算 =================
  function stage6_1() {
    const s = stage({
      id: '6-1', name: '決算フロア', theme: 'office', w: 241, time: 170,
      memo: '業務連絡：決算期です。全員、定時までに数字を締めてください。',
    });
    s.ground(0, 40).ground(44, 80).ground(85, 118).ground(124, 160).ground(165, 200).ground(205, 240);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 13).enemy('box', 15).enemy('box', 17).enemy('virus', 21);
    s.pipe(25, 3, true).pipe(31, 4, true);
    s.enemy('spam', 36, 6);
    s.coinRow(41, 8, 3);
    s.blocks(47, 8, 'BBBBBBBB').blocks(47, 4, 'BC?BB?SB').enemy('box', 49, 7).enemy('box', 52, 7);
    s.enemy('virus', 58).enemy('virus', 61);
    s.semi(64, 9, 3).semi(68, 7, 3).semi(72, 5, 3).coinRow(72, 4, 3);
    s.enemy('spam', 75, 8).enemy('box', 77);
    s.coinRow(81, 8, 4);
    s.checkpoint(86);
    s.pipe(92, 2, true).pipe(97, 3, true);
    s.enemy('virus', 102).enemy('virus', 105);
    s.blocks(108, 8, 'B?B');
    s.enemy('box', 111).enemy('box', 113).enemy('spam', 116, 6);
    s.coinRow(119, 8, 5);
    s.lift(127, 11, 'y', 5, 11).semi(130, 5, 6).coinRow(130, 4, 6);
    s.enemy('virus', 128).enemy('virus', 133);
    s.blocks(137, 8, 'BBCBB').enemy('box', 139, 7);
    s.enemy('spam', 145, 7);
    s.pipe(150, 4, true);
    s.enemy('virus', 156);
    s.coinRow(161, 8, 4);
    s.checkpoint(168);
    s.semi(171, 9, 3).semi(175, 7, 3).enemy('box', 176, 6);
    s.enemy('spam', 181, 5);
    s.blocks(184, 8, 'BHB');
    s.enemy('box', 188).enemy('box', 190).enemy('virus', 194);
    s.pipe(197, 3, true);
    s.coinRow(201, 8, 4);
    s.stairs(210, 8).column(218, 8);
    s.goalAt(229);
    return s;
  }

  function stage6_2() {
    const s = stage({
      id: '6-2', name: '地下の機密書庫', theme: 'basement', w: 244, time: 180,
      memo: '業務連絡：機密書庫の黒電話には絶対に出ないでください。絶対にです。',
    });
    s.ground(0, 34).ground(38, 68).ground(72, 104).ground(112, 142).ground(146, 176).ground(184, 243);
    s.ceiling(4, 226);
    s.blocks(8, 8, '?M?');
    s.pipe(13, 2, true).pipe(18, 3, true);
    s.enemy('virus', 23).enemy('virus', 26).enemy('box', 29);
    s.coinRow(35, 8, 3);
    s.blocks(40, 9, 'BBBBBBBB').blocks(40, 5, 'BBC?BBKB').coinRow(41, 7, 6);
    s.enemy('box', 42, 8).enemy('virus', 45, 8);
    s.pipe(51, 4, true);
    s.enemy('box', 57).enemy('box', 59).enemy('box', 61);
    s.blocks(64, 8, 'B?B');
    s.coinRow(69, 8, 3);
    s.stairs(75, 4).semi(79, 8, 6).coinRow(79, 7, 6).enemy('box', 81, 7);
    s.enemy('virus', 87).enemy('virus', 90);
    s.pipe(94, 3, true).pipe(99, 2, true);
    s.lift(105, 10, 'x', 105, 109, 1.2).coinRow(106, 6, 4);
    s.checkpoint(115);
    s.enemy('virus', 119).enemy('virus', 122).enemy('box', 125);
    s.blocks(128, 9, 'BBBBBB').blocks(128, 5, 'B?BB?B').coinRow(129, 7, 4);
    s.pipe(137, 3, true);
    s.coinRow(143, 8, 3);
    s.enemy('box', 150).enemy('box', 152).enemy('virus', 156);
    s.blocks(160, 8, '?S?');
    s.pipe(165, 4, true);
    s.enemy('virus', 171).enemy('virus', 174);
    s.lift(178, 11, 'y', 6, 11).lift(181, 6, 'y', 6, 11, 1.25).coinRow(179, 4, 4);
    s.blocks(188, 8, 'H');
    s.stairs(192, 5).column(197, 5);
    s.hole(198, 200);
    s.stairs(201, 5, -1);
    s.pipe(210, 3, true);
    s.enemy('box', 216).enemy('box', 218);
    s.goalAt(232);
    return s;
  }

  function stage6_3() {
    const s = stage({
      id: '6-3', name: '最上階・役員フロア', theme: 'night', w: 230, time: 170,
      memo: '業務連絡：役員フロアでは静かに走ってください。',
    });
    s.ground(0, 38).ground(42, 74).ground(79, 112).ground(117, 150).ground(156, 186).ground(191, 229);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 14).enemy('box', 16).enemy('spam', 21, 7);
    s.semi(25, 9, 4).semi(31, 7, 4).coinRow(31, 6, 4);
    s.enemy('virus', 36);
    s.coinRow(39, 8, 3);
    s.pipe(45, 3, true);
    s.blocks(50, 8, 'BBBBBB').blocks(50, 4, 'B?BBCB').enemy('box', 52, 7).enemy('box', 54, 7);
    s.enemy('spam', 60, 5).enemy('spam', 63, 8);
    s.enemy('virus', 67).enemy('virus', 70);
    s.coinRow(75, 8, 4);
    s.checkpoint(82);
    s.lift(86, 11, 'y', 5, 11).semi(89, 5, 6).coinRow(89, 4, 6);
    s.enemy('box', 88).enemy('box', 91).enemy('box', 94);
    s.pipe(98, 4, true);
    s.blocks(104, 8, '?S?');
    s.enemy('virus', 108);
    s.coinRow(113, 8, 4);
    s.stairs(120, 4).column(124, 4);
    s.enemy('box', 128).enemy('box', 130).enemy('spam', 134, 6);
    s.blocks(138, 8, 'B?B');
    s.enemy('virus', 142).enemy('virus', 145);
    s.coinRow(151, 8, 5);
    s.checkpoint(160);
    s.semi(163, 9, 3).semi(167, 7, 3).semi(171, 5, 3).coinRow(171, 4, 3);
    s.enemy('spam', 175, 7);
    s.pipe(179, 3, true);
    s.enemy('box', 184);
    s.coinRow(187, 8, 4);
    s.enemy('virus', 195);
    s.stairs(199, 8).column(207, 8);
    s.goalAt(218);
    return s;
  }

  function stage6_4() {
    const s = stage({
      id: '6-4', name: '定時ダッシュ・ファイナル', theme: 'nightstreet', w: 251, time: 170, chaser: true,
      memo: '業務連絡：年度最後の定時です。締め切りを振り切って、タイムカードを押してください。',
    });
    s.ground(0, 34).ground(38, 70).ground(75, 104).ground(109, 140).ground(145, 176).ground(181, 212).ground(216, 250);
    s.blocks(8, 8, '?M?');
    s.enemy('box', 13).enemy('box', 15).enemy('spam', 19, 7).enemy('virus', 22);
    s.pipe(26, 3, true);
    s.semi(30, 9, 3).coinRow(30, 8, 3);
    s.coinRow(35, 8, 3);
    s.blocks(41, 8, 'B?B?B').blocks(43, 4, 'S').enemy('box', 42, 7);
    s.enemy('spam', 49, 5).enemy('spam', 52, 8).enemy('virus', 56).enemy('virus', 59);
    s.pipe(63, 4, true);
    s.enemy('box', 67);
    s.coinRow(71, 8, 4);
    s.checkpoint(78);
    s.semi(82, 9, 3).semi(86, 7, 3).semi(90, 5, 3).coinRow(90, 4, 3);
    s.enemy('spam', 94, 7).enemy('box', 97).enemy('box', 99);
    s.blocks(101, 8, '?D?');
    s.coinRow(105, 8, 4);
    s.enemy('virus', 113).enemy('virus', 116);
    s.pipe(120, 3, true).pipe(126, 2, true);
    s.enemy('box', 131).enemy('box', 133).enemy('spam', 137, 6);
    s.coinRow(141, 8, 4);
    s.checkpoint(148);
    s.blocks(151, 8, 'BBCBB').enemy('box', 153, 7);
    s.enemy('virus', 159).enemy('virus', 162).enemy('spam', 166, 7);
    s.pipe(170, 3, true);
    s.enemy('box', 174);
    s.coinRow(177, 8, 4);
    s.semi(184, 9, 3).semi(188, 7, 3).coinRow(188, 6, 3);
    s.enemy('spam', 193, 6).enemy('virus', 197);
    s.blocks(201, 8, 'BHB');
    s.pipe(207, 4, true);
    s.coinRow(213, 8, 3);
    s.stairs(220, 8).column(228, 8);
    s.goalAt(239);
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
