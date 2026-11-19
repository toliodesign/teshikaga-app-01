// 使い方：  node scripts/check-timetable.mjs            … 入力ミスの検査
//          node scripts/check-timetable.mjs 旧.json    … 検査＋旧データとの差分表示
import fs from 'fs';
const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const data = load(new URL('../src/timetable.json', import.meta.url));
const errors = [];
const err = m => errors.push(m);

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const min = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const STOPS = ['kawayu', 'biruwa', 'mashuEki'];          // 川湯側 → 摩周側の順
const ORDER = { to_mashu: STOPS, to_kawayu: [...STOPS].reverse() };

// バス
const ids = new Set();
for (const t of data.busTrips) {
  const L = `バス${t.id}便`;
  if (ids.has(t.id)) err(`${L}：便番号が重複しています`);
  ids.add(t.id);
  if (!ORDER[t.dir]) { err(`${L}：dir が不正です（${t.dir}）`); continue; }
  for (const [k, v] of Object.entries(t.stops)) {
    if (!STOPS.includes(k)) err(`${L}：停留所名が不明です（${k}）`);
    else if (!TIME.test(v)) err(`${L} ${k}：時刻の形式が不正です（${v}）`);
  }
  if (t.sectionOnly && (t.stops.biruwa || t.stops.kawayu))
    err(`${L}：区間便なのに美留和・川湯駅の時刻があります`);
  const seq = ORDER[t.dir].filter(k => t.stops[k]).map(k => [k, min(t.stops[k])]);
  for (let i = 1; i < seq.length; i++)
    if (seq[i][1] <= seq[i - 1][1]) err(`${L}：${seq[i - 1][0]}→${seq[i][0]} の時刻が進んでいません`);
  if (!t.sectionOnly && STOPS.some(k => !t.stops[k]))
    err(`${L}：区間便ではないのに、時刻のない停留所があります`);
}
// JR
for (const [st, v] of Object.entries(data.jr))
  for (const dir of ['kushiro', 'abashiri']) {
    const a = v[dir];
    a.forEach(x => { if (!TIME.test(x)) err(`JR ${st} ${dir}：時刻の形式が不正です（${x}）`); });
    for (let i = 1; i < a.length; i++)
      if (TIME.test(a[i]) && TIME.test(a[i - 1]) && min(a[i]) <= min(a[i - 1]))
        err(`JR ${st} ${dir}：${a[i - 1]} の次の ${a[i]} が昇順になっていません`);
  }

// 旧データとの差分（任意）
if (process.argv[2]) {
  const old = load(process.argv[2]), out = [];
  const bus = d => Object.fromEntries(d.busTrips.flatMap(t => Object.entries(t.stops).map(([k, v]) => [`バス${t.id}便 ${k}`, v])));
  const jr = d => Object.fromEntries(Object.entries(d.jr).flatMap(([s, v]) => ['kushiro', 'abashiri'].map(r => [`JR ${s} ${r}`, v[r].join(' ')])));
  for (const f of [bus, jr]) {
    const o = f(old), n = f(data);
    for (const k of new Set([...Object.keys(o), ...Object.keys(n)]))
      if (o[k] !== n[k]) out.push(`${k}：${o[k] ?? '（なし）'} → ${n[k] ?? '（なし）'}`);
  }
  console.log(out.length ? `【旧データとの差分 ${out.length}件】\n` + out.join('\n') : '旧データとの差分はありません');
}
console.log(errors.length ? `\n【エラー ${errors.length}件】\n` + errors.join('\n') : '\n検査OK：問題は見つかりませんでした');
process.exit(errors.length ? 1 : 0);

