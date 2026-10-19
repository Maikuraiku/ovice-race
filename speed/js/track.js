// コース定義と幾何計算（海の上の高架道路）
const Track = (() => {
  // 大型の高速サーキット（直線と円弧で設計した中心線を約 425 間隔で並べたもの）
  // 左右どちらのカーブもあり、S 字・大きな U ターン（上から食い込む部分）・うねりを組み合わせている。
  // 一番きついところでも半径約 800、隣り合う区間の間隔は 2,000 以上
  const CONTROL = [
    [1697, 9061], [1697, 8636], [1692, 8212], [1639, 7791], [1525, 7382], [1354, 6993], [1158, 6616], [1013, 6218],
    [927, 5802], [900, 5379], [934, 4955], [1028, 4542], [1180, 4145], [1379, 3770], [1542, 3379], [1648, 2968],
    [1695, 2546], [1729, 2123], [1870, 1725], [2116, 1379], [2445, 1115], [2835, 951], [3256, 900], [3681, 900],
    [4105, 907], [4526, 965], [4933, 1082], [5321, 1256], [5698, 1451], [6099, 1592], [6514, 1674], [6938, 1698],
    [7352, 1787], [7714, 2005], [7984, 2330], [8134, 2725], [8158, 3148], [8158, 3572], [8158, 3997], [8158, 4422],
    [8158, 4847], [8158, 5272], [8158, 5697], [8230, 6113], [8434, 6484], [8747, 6767], [9137, 6932], [9558, 6961],
    [9966, 6850], [10315, 6613], [10568, 6274], [10695, 5870], [10708, 5446], [10708, 5022], [10708, 4597], [10708, 4172],
    [10708, 3748], [10708, 3323], [10711, 2898], [10805, 2486], [11029, 2127], [11358, 1861], [11755, 1718], [12179, 1691],
    [12599, 1633], [13007, 1515], [13393, 1341], [13771, 1147], [14171, 1006], [14588, 923], [15011, 901], [15429, 966],
    [15818, 1134], [16154, 1392], [16416, 1725], [16587, 2113], [16656, 2530], [16688, 2954], [16800, 3362], [16991, 3742],
    [17253, 4074], [17527, 4398], [17732, 4769], [17859, 5174], [17903, 5595], [17863, 6018], [17739, 6423], [17538, 6796],
    [17267, 7122], [17002, 7453], [16807, 7830], [16691, 8238], [16658, 8661], [16658, 9086], [16655, 9510], [16575, 9926],
    [16395, 10310], [16126, 10637], [15784, 10887], [15391, 11045], [14971, 11101], [14547, 11101], [14122, 11101], [13697, 11101],
    [13273, 11102], [12850, 11146], [12440, 11256], [12052, 11427], [11696, 11657], [11378, 11938], [11050, 12207], [10684, 12422],
    [10289, 12576], [9874, 12667], [9451, 12694], [9029, 12654], [8617, 12548], [8228, 12380], [7869, 12154], [7550, 11874],
    [7224, 11602], [6859, 11385], [6466, 11227], [6053, 11131], [5629, 11101], [5205, 11101], [4780, 11101], [4355, 11101],
    [3931, 11101], [3506, 11088], [3092, 10996], [2706, 10821], [2365, 10570], [2082, 10253], [1872, 9886], [1742, 9482],
  ];
  const WIDTH = 480; // 道路の幅
  const MARGIN = 20; // 道路の縁（ここを越えると海へ落下）
  const SEG = 8; // 制御点が細かいので補間は少なめで十分

  const pts = [];
  const n = CONTROL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL[(i - 1 + n) % n], p1 = CONTROL[i];
    const p2 = CONTROL[(i + 1) % n], p3 = CONTROL[(i + 2) % n];
    for (let j = 0; j < SEG; j++) {
      const t = j / SEG, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  const N = pts.length;
  const cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const length = cum[N];

  const wrap = s => ((s % length) + length) % length;

  // 中心線上の最寄り点。s: スタートからの距離, lat: 進行方向右(+)/左(-)へのずれ, dist: 中心線からの距離
  function nearest(x, y) {
    let best = null, bestD2 = Infinity;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const abx = b.x - a.x, aby = b.y - a.y;
      const l2 = abx * abx + aby * aby;
      let t = ((x - a.x) * abx + (y - a.y) * aby) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t, py = a.y + aby * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { i, t, px, py, abx, aby };
      }
    }
    const segLen = cum[best.i + 1] - cum[best.i];
    const tx = best.abx / segLen, ty = best.aby / segLen;
    return {
      s: cum[best.i] + best.t * segLen,
      px: best.px, py: best.py, tx, ty,
      lat: (x - best.px) * -ty + (y - best.py) * tx,
      dist: Math.sqrt(bestD2),
    };
  }

  // 距離 s の位置と接線
  function pointAt(s) {
    s = wrap(s);
    let lo = 0, hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid - 1;
    }
    const a = pts[lo], b = pts[(lo + 1) % N];
    const segLen = cum[lo + 1] - cum[lo];
    const t = (s - cum[lo]) / segLen;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / segLen, ty: (b.y - a.y) / segLen };
  }

  // 中心線から横に off だけずらした線（車線や縁の線を描く用）
  function offsetLine(off) {
    return pts.map((p, i) => {
      const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      return { x: p.x + (-dy / l) * off, y: p.y + (dx / l) * off };
    });
  }

  // 外枠
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = WIDTH / 2 + MARGIN + 300;
  const bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

  // ダッシュパネル（s はコース長に対する割合）
  const boosts = [
    { s: 0.03, lat: 0 },
    { s: 0.15, lat: -120 },
    { s: 0.27, lat: 120 },
    { s: 0.4, lat: 0 },
    { s: 0.52, lat: -120 },
    { s: 0.64, lat: 120 },
    { s: 0.76, lat: 0 },
    { s: 0.88, lat: -120 },
  ].map(b => ({ s: b.s * length, lat: b.lat, len: 150, w: 140 }));

  // 街灯：道路の両脇に等間隔（左右で半分ずらす）
  const LIGHT_GAP = 300;
  const lights = [];
  for (let s = 0; s < length; s += LIGHT_GAP) {
    for (const side of [-1, 1]) {
      const p = pointAt(s + (side > 0 ? LIGHT_GAP / 2 : 0));
      const nx = -p.ty * side, ny = p.tx * side; // 道路の外向き
      lights.push({
        x: p.x + nx * (WIDTH / 2 + MARGIN - 6), // 柱（道路の縁）
        y: p.y + ny * (WIDTH / 2 + MARGIN - 6),
        lx: p.x + nx * (WIDTH / 2 - 50), // 灯具（道路の上に張り出す）
        ly: p.y + ny * (WIDTH / 2 - 50),
      });
    }
  }

  return { pts, length, width: WIDTH, margin: MARGIN, nearest, pointAt, wrap, bounds, boosts, lights, offsetLine };
})();
