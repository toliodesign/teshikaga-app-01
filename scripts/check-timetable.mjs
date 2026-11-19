// 時刻データ（src/timetable.json）の入力ミスを検査します。
// エラーがあると終了コード1で止まるので、公開（ビルド）の前に実行すると、誤ったデータの公開を防げます。
import fs from 'fs';
const data = JSON.parse(fs.readFileSync(new URL('../src/timetable.json', import.meta.url), 'utf8'));
const errors = [];
const err = m => errors.push(m);

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const min = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const STOPS = ['kawayu', 'biruwa', 'mashu'];          // 川湯側 → 摩周側の順
const STOP_LABEL = { kawayu: '川湯駅', biruwa: '美留和', mashu: '摩周駅前' };

// 必須の項目
if (!data.meta?.busRevision) err('meta.busRevision（バスマップの発行年月）がありません');
for (const k of STOPS) {
  if (!data.jr?.[k]) err(`jr.${k} がありません`);
  if (!data.bus?.stops?.[k]) err(`bus.stops.${k} がありません`);
}
if (errors.length === 0) {
  const { tripDirection, sectionOnly, stops } = data.bus;
  // JR：形式と昇順
  for (const k of STOPS) for (const dir of ['kushiro', 'abashiri']) {
    const a = data.jr[k][dir];
    a.forEach(x => { if (!TIME.test(x)) err(`JR ${k} ${dir}：時刻の形式が不正です（${x}）`); });
    for (let i = 1; i < a.length; i++)
      if (TIME.test(a[i]) && TIME.test(a[i - 1]) && min(a[i]) <= min(a[i - 1]))
        err(`JR ${k} ${dir}：${a[i - 1]} の次の ${a[i]} が昇順になっていません`);
  }
  // バス：形式
  const ids = new Set();
  for (const k of STOPS) for (const [id, t] of Object.entries(stops[k])) {
    ids.add(id);
    if (!TIME.test(t)) err(`バス${id}便 ${STOP_LABEL[k]}：時刻の形式が不正です（${t}）`);
  }
  // バス：便ごとの検査
  for (const id of ids) {
    const L = `バス${id}便`;
    const dir = tripDirection[id];
    if (dir !== 'to_mashu' && dir !== 'to_kawayu') { err(`${L}：進行方向（tripDirection）が未設定または不正です`); continue; }
    const isSection = sectionOnly.includes(id);
    const present = STOPS.filter(k => stops[k][id]);
    if (isSection && present.some(k => k !== 'mashu')) err(`${L}：区間便なのに、美留和・川湯駅の時刻があります`);
    if (!isSection && present.length !== STOPS.length) err(`${L}：区間便ではないのに、時刻のない停留所があります`);
    const order = dir === 'to_mashu' ? STOPS : [...STOPS].reverse();
    const seq = order.filter(k => stops[k][id] && TIME.test(stops[k][id]));
    for (let i = 1; i < seq.length; i++)
      if (min(stops[seq[i]][id]) <= min(stops[seq[i - 1]][id]))
        err(`${L}：${STOP_LABEL[seq[i - 1]]}→${STOP_LABEL[seq[i]]} の時刻が進んでいません`);
  }
  for (const id of sectionOnly) if (!ids.has(id)) err(`sectionOnly の ${id}便 が、時刻データにありません`);
  for (const id of Object.keys(tripDirection)) if (!ids.has(id)) err(`tripDirection の ${id}便 が、時刻データにありません`);
}
console.log(errors.length ? `【エラー ${errors.length}件】\n` + errors.join('\n') : '検査OK：問題は見つかりませんでした');
process.exit(errors.length ? 1 : 0);
