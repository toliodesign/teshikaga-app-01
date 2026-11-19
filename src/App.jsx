import React, { useState, useMemo, useEffect } from 'react';

import timetable from './timetable.json';

// ============ データ ============
// 時刻データは timetable.json に分けてあります。時刻表の改定時は、そのファイルだけを直してください。
// 直したあとは `npm run check` で入力ミスを検査できます。
const toMin = (h, m) => h * 60 + m;
const parseTime = (str) => {
  const [h, m] = str.split(':').map(Number);
  return toMin(h, m);
};

const busTrips = timetable.busTrips.map(t => ({
  id: t.id,
  dir: t.dir,
  sectionOnly: !!t.sectionOnly,
  stops: Object.fromEntries(Object.entries(t.stops).map(([k, v]) => [k, parseTime(v)])),
}));

const jrTimes = Object.fromEntries(
  Object.entries(timetable.jr).map(([k, v]) => [k, {
    name: v.name,
    kushiro: v.kushiro.map(parseTime),
    abashiri: v.abashiri.map(parseTime),
  }])
);

const busStopLabel = { mashuEki: '摩周駅前', biruwa: '美留和', kawayu: '川湯駅' };
const jrStationLabel = { mashu: '摩周駅', biruwa: '美留和駅', kawayu: '川湯温泉駅' };

function fmt(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ============ 乗換検索ロジック ============
// 「JR駅で降りて、その後バスに乗る」または「バス停で降りて、その後JRに乗る」の
// 直近の乗り継ぎ候補を計算する。乗換に必要な最短時間は5分と仮定。
const MIN_TRANSFER = 5;

// 91・93・98便は「摩周駅前⇔開発前」間のみの区間便で、美留和・川湯駅・川湯市街地の
// いずれにも行かない。目的地の停留所が busStopKey として指定されている時点で、
// その停留所を通らない便は stops[busStopKey] が undefined になるため、
// 実質的に自動で除外される（区間便のオブジェクトに mashuEki 以外のキーを含めていない）。
// ただし「摩周駅前へ乗るだけ」のケースで区間便を誤って美留和・川湯方面の便として
// 案内しないよう、区間便には目的地方面フラグを明示しておく。
const SECTION_ONLY_TRIPS = busTrips.filter(t => t.sectionOnly).map(t => t.id);
// 「基準時刻(afterMin)以降で最初に来る便」を0番目とし、そこから skip 分だけ前後にずらした便を返す。
// skip=0: 直近の便、skip=1: 1本後、skip=-1: 1本前。候補が無い場合は null。
function findBusAfter(busStopKey, afterMin, direction, skip = 0) {
  const all = busTrips
    .filter(t => t.dir === direction && t.stops[busStopKey] != null)
    .sort((a, b) => a.stops[busStopKey] - b.stops[busStopKey]);
  const baseIndex = all.findIndex(t => t.stops[busStopKey] >= afterMin);
  if (baseIndex === -1) return null; // 基準時刻以降に便がない場合、前方向にずらす起点も存在しない
  const targetIndex = baseIndex + skip;
  return targetIndex >= 0 && targetIndex < all.length ? all[targetIndex] : null;
}
function isSectionOnly(tripId) {
  return SECTION_ONLY_TRIPS.includes(tripId);
}

function findJrAfter(jrStationKey, afterMin, direction, skip = 0) {
  const all = jrTimes[jrStationKey][direction].slice().sort((a, b) => a - b);
  const baseIndex = all.findIndex(t => t >= afterMin);
  if (baseIndex === -1) return null;
  const targetIndex = baseIndex + skip;
  return targetIndex >= 0 && targetIndex < all.length ? all[targetIndex] : null;
}

// ============ UIコンポーネント ============
const ROUTE_OPTIONS = [
  { key: 'jr_to_bus_mashu', label: 'JRで摩周駅に到着 → バスでどこかへ' },
  { key: 'jr_to_bus_biruwa', label: 'JRで美留和駅に到着 → バスでどこかへ' },
  { key: 'jr_to_bus_kawayu', label: 'JRで川湯温泉駅に到着 → バスでどこかへ' },
  { key: 'bus_to_jr_mashu', label: 'バスで摩周駅前に到着 → JRでどこかへ' },
  { key: 'bus_to_jr_biruwa', label: 'バスで美留和に到着 → JRでどこかへ' },
  { key: 'bus_to_jr_kawayu', label: 'バスで川湯駅に到着 → JRでどこかへ' },
];

export default function App() {
  const [mode, setMode] = useState('jr_to_bus_mashu');
  const [jrDir, setJrDir] = useState('kushiro'); // JR到着方向: kushiro=釧路方面から, abashiri=網走方面から
  const [busDir, setBusDir] = useState('to_mashu'); // バス到着方向
  const [selectedTime, setSelectedTime] = useState(null); // 選んだ「実際の到着時刻」（分）
  const [skipCount, setSkipCount] = useState(0); // 「次の便」を何回押したか(0=直近の便)

  // ①のモードに応じて、②で選べる「実在する到着時刻」の一覧を作る
  const availableTimes = useMemo(() => {
    if (mode.startsWith('jr_to_bus')) {
      const stationKey = mode.replace('jr_to_bus_', '');
      return jrTimes[stationKey][jrDir];
    } else {
      const stationKey = mode.replace('bus_to_jr_', '');
      const busStopKey = stationKey === 'mashu' ? 'mashuEki' : stationKey;
      return busTrips
        .filter(t => t.dir === busDir && t.stops[busStopKey] != null)
        .map(t => t.stops[busStopKey])
        .sort((a, b) => a - b);
    }
  }, [mode, jrDir, busDir]);

  // モードや方向を変えたら、選択済みの時刻と「次の便」の状態をリセットする
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setSelectedTime(null);
    setSkipCount(0);
  };
  const handleDirChange = (setter, value) => {
    setter(value);
    setSelectedTime(null);
    setSkipCount(0);
  };
  const handleSelectTime = (t) => {
    setSelectedTime(t);
    setSkipCount(0); // 到着時刻を選び直したら「次の便」もリセット
  };

  const result = useMemo(() => {
    if (selectedTime == null) return null;
    const canTransfer = selectedTime + MIN_TRANSFER;
    if (mode.startsWith('jr_to_bus')) {
      const stationKey = mode.replace('jr_to_bus_', '');
      const busStopKey = stationKey === 'mashu' ? 'mashuEki' : stationKey;
      const bus = findBusAfter(busStopKey, canTransfer, busDir, skipCount);
      const hasNext = findBusAfter(busStopKey, canTransfer, busDir, skipCount + 1) != null;
      const hasPrev = findBusAfter(busStopKey, canTransfer, busDir, skipCount - 1) != null;
      return { type: 'jr_to_bus', stationKey, busStopKey, bus, canTransfer, hasNext, hasPrev };
    } else {
      const stationKey = mode.replace('bus_to_jr_', '');
      const jrStationKey = stationKey === 'mashu' ? 'mashu' : stationKey;
      const jr = findJrAfter(jrStationKey, canTransfer, jrDir, skipCount);
      const hasNext = findJrAfter(jrStationKey, canTransfer, jrDir, skipCount + 1) != null;
      const hasPrev = findJrAfter(jrStationKey, canTransfer, jrDir, skipCount - 1) != null;
      return { type: 'bus_to_jr', stationKey, jr, canTransfer, hasNext, hasPrev };
    }
  }, [mode, selectedTime, jrDir, busDir, skipCount]);

  // JR釧網本線は、摩周駅・美留和駅・川湯温泉駅のいずれも途中駅であり、路線の終端ではない。
  // そのため「バスで到着→JRでどこかへ」の場合、釧路方面・網走方面のどちらも常に意味を持つ。
  const busToJrStationKey = mode.startsWith('bus_to_jr') ? mode.replace('bus_to_jr_', '') : null;

  // ③でJRの行き先(釧路方面 / 網走方面)を切り替えたときは、時刻はそのまま、方向だけ変える
  const handleJrDirChangeInResult = (value) => {
    setJrDir(value);
    setSkipCount(0); // 行き先が変われば「次の便」も最初からやり直す
    // selectedTimeは維持する(バスの到着時刻は変わらないため)
  };

  // 停留所の並び順（川湯温泉側 → 摩周側）。ある駅から見て「意味の通る行き先方向」を判定するために使う。
  // 「摩周駅前」は美留和線の終点(摩周側の端)なので、「摩周駅前方面へ」は意味が成立しない。
  // 「川湯駅」「美留和」は美留和線の途中の停留所であり、そこからさらに川湯市街地(川湯温泉市街地)へ
  // 向かう便も、摩周方面へ向かう便も、どちらも実際に存在するため、両方とも意味を持つ。
  const jrToBusStationKey = mode.startsWith('jr_to_bus') ? mode.replace('jr_to_bus_', '') : null;
  const jrToBusStopKey = jrToBusStationKey === 'mashu' ? 'mashuEki' : jrToBusStationKey;
  const showToKawayuOption = true; // 摩周駅・美留和駅・川湯温泉駅、いずれで降りても川湯市街地方面への便は存在する
  const showToMashuOption = jrToBusStopKey !== 'mashuEki'; // 摩周駅前は美留和線の終点なので、ここへ「向かう」便を出すのは無意味

  // ③で選べる行き先が1つしかない場合は、その方向に自動で固定する
  useEffect(() => {
    if (!mode.startsWith('jr_to_bus')) return;
    if (!showToKawayuOption) setBusDir('to_mashu');
    else if (!showToMashuOption) setBusDir('to_kawayu');
  }, [mode]);

  // ③のボタンに表示するラベルは、降りた駅によって適切な表現に変える。
  // 摩周駅・美留和駅で降りた場合は「川湯温泉方面へ」で自然だが、
  // 川湯温泉駅で降りた場合はすでに川湯温泉にいるため、実際の行き先である「川湯市街地方面へ」と表示する。
  const toKawayuLabel = jrToBusStopKey === 'kawayu' ? '川湯市街地方面へ' : '川湯温泉方面へ';


  // ③でバスの行き先(川湯温泉方面 / 摩周方面)を切り替えたときは、時刻はそのまま、方向だけ変える
  const handleBusDirChangeInResult = (value) => {
    setBusDir(value);
    setSkipCount(0); // 行き先が変われば「次の便」も最初からやり直す
    // selectedTimeは維持する(JRの到着時刻は変わらないため)
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.kicker}>弟子屈町 交通案内</div>
          <h1 style={styles.title}>摩周・美留和・川湯温泉<br />乗換案内</h1>
          <p style={styles.subtitle}>JR釧網本線と阿寒バス美留和線の乗り継ぎを調べます（毎日同じダイヤです）</p>
        </header>

        <section style={styles.card}>
          <div style={styles.stepLabel}>① どちらから、どちらへ乗り継ぎますか</div>
          <div style={styles.optionGrid}>
            {ROUTE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => handleModeChange(opt.key)}
                style={{
                  ...styles.optionButton,
                  ...(mode === opt.key ? styles.optionButtonActive : {}),
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          {mode.startsWith('jr_to_bus') && (
            <div style={styles.dirRow}>
              <span style={styles.dirLabel}>JRが来る方向</span>
              <button onClick={() => handleDirChange(setJrDir, 'kushiro')} style={{...styles.dirButton, ...(jrDir==='kushiro'?styles.dirButtonActive:{})}}>釧路方面から</button>
              <button onClick={() => handleDirChange(setJrDir, 'abashiri')} style={{...styles.dirButton, ...(jrDir==='abashiri'?styles.dirButtonActive:{})}}>網走方面から</button>
            </div>
          )}
          {mode.startsWith('bus_to_jr') && (
            <div style={styles.dirRow}>
              <span style={styles.dirLabel}>乗ってきたバスの向き</span>
              <button onClick={() => handleDirChange(setBusDir, 'to_mashu')} style={{...styles.dirButton, ...(busDir==='to_mashu'?styles.dirButtonActive:{})}}>川湯温泉側→摩周方面ゆき</button>
              <button onClick={() => handleDirChange(setBusDir, 'to_kawayu')} style={{...styles.dirButton, ...(busDir==='to_kawayu'?styles.dirButtonActive:{})}}>摩周方面→川湯温泉側ゆき</button>
            </div>
          )}

          <div style={styles.stepLabel2}>② 到着する時刻を選んでください</div>
          <div style={styles.timeGrid}>
            {availableTimes.length === 0 && (
              <div style={styles.emptyTimes}>この条件では便がありません</div>
            )}
            {availableTimes.map((t, i) => (
              <button
                key={i}
                onClick={() => handleSelectTime(t)}
                style={{
                  ...styles.timeChip,
                  ...(selectedTime === t ? styles.timeChipActive : {}),
                }}
              >
                {fmt(t)}
              </button>
            ))}
          </div>
        </section>

        <section style={styles.resultCard}>
          <div style={styles.stepLabel}>③ 乗り継ぎ候補</div>

          {mode.startsWith('jr_to_bus') && (showToKawayuOption || showToMashuOption) && (
            <div style={styles.resultDirRow}>
              <span style={styles.resultDirLabel}>バスの行き先</span>
              {showToKawayuOption && (
                <button
                  onClick={() => handleBusDirChangeInResult('to_kawayu')}
                  style={{...styles.resultDirButton, ...(busDir==='to_kawayu'?styles.resultDirButtonActive:{})}}
                >
                  {toKawayuLabel}
                </button>
              )}
              {showToMashuOption && (
                <button
                  onClick={() => handleBusDirChangeInResult('to_mashu')}
                  style={{...styles.resultDirButton, ...(busDir==='to_mashu'?styles.resultDirButtonActive:{})}}
                >
                  摩周駅前方面へ
                </button>
              )}
            </div>
          )}

          {mode.startsWith('bus_to_jr') && (
            <div style={styles.resultDirRow}>
              <span style={styles.resultDirLabel}>JRの行き先</span>
              <button
                onClick={() => handleJrDirChangeInResult('kushiro')}
                style={{...styles.resultDirButton, ...(jrDir==='kushiro'?styles.resultDirButtonActive:{})}}
              >
                釧路方面へ
              </button>
              <button
                onClick={() => handleJrDirChangeInResult('abashiri')}
                style={{...styles.resultDirButton, ...(jrDir==='abashiri'?styles.resultDirButtonActive:{})}}
              >
                網走方面へ
              </button>
            </div>
          )}

          {selectedTime == null ? (
            <div style={styles.noResult}>
              <p>上の②で、到着時刻を選んでください。</p>
            </div>
          ) : (
            <ResultDisplay
              result={result}
              arriveMin={selectedTime}
              skipCount={skipCount}
              onNext={() => setSkipCount(c => c + 1)}
              onPrev={() => setSkipCount(c => c - 1)}
            />
          )}
        </section>

        <footer style={styles.footer}>
          <p>出典：弟子屈町地域公共交通活性化協議会「弟子屈バスマップ」({timetable.meta.busRevision}) ／ JR北海道 釧網本線時刻表（Yahoo!路線情報より）</p>
          <p style={styles.footerNote}>※バス・JRとも、平日・土曜・日曜祝日で同じダイヤであることを確認済みのため、曜日を問わずこの時刻表をご利用いただけます。乗換に必要な時間は5分と仮定しています。実際にご利用の際は最新の公式時刻表もあわせてご確認ください。</p>
        </footer>
      </div>
    </div>
  );
}

function ResultDisplay({ result, arriveMin, skipCount, onNext, onPrev }) {
  if (result.type === 'jr_to_bus') {
    const stopName = busStopLabel[result.busStopKey === 'mashu' ? 'mashuEki' : result.busStopKey] || busStopLabel[result.busStopKey];
    if (!result.bus) {
      const direction = skipCount > 0 ? 'これ以上後の' : skipCount < 0 ? 'これより前の' : '';
      return (
        <div style={styles.noResult}>
          <div style={styles.noResultIcon}>—</div>
          <p>{fmt(arriveMin)}以降、{direction}この方向のバスが見つかりませんでした。</p>
        </div>
      );
    }
    const boardTime = result.bus.stops[result.busStopKey];
    const wait = boardTime - arriveMin;
    const sectionOnly = isSectionOnly(result.bus.id);
    const missedConnection = wait < MIN_TRANSFER; // 1本前などに戻した結果、乗換に間に合わない場合
    return (
      <div style={styles.resultBox}>
        {skipCount !== 0 && (
          <div style={styles.skipBadge}>{skipCount > 0 ? `${skipCount}本後` : `${-skipCount}本前`}の候補</div>
        )}
        <div style={styles.resultLine}>
          <span style={styles.resultBadge}>JR到着</span>
          <span style={styles.resultTime}>{fmt(arriveMin)}</span>
        </div>
        <div style={styles.arrow}>↓ 待ち時間 約{wait}分</div>
        <div style={styles.resultLine}>
          <span style={styles.resultBadge}>バス乗車</span>
          <span style={styles.resultTime}>{fmt(boardTime)}</span>
          <span style={styles.resultSub}>{result.bus.id}便・{stopName}発</span>
        </div>
        {missedConnection && (
          <div style={styles.warningBox}>
            ⚠ この時刻ではすでに発車済み、または乗換に間に合いません。参考情報としてご覧ください。
          </div>
        )}
        {sectionOnly && (
          <div style={styles.warningBox}>
            ⚠ この便（{result.bus.id}便）は「開発前」までの区間便です。美留和・川湯温泉方面へは行きませんのでご注意ください。
          </div>
        )}
        <div style={styles.navRow}>
          {result.hasPrev && (
            <button style={styles.navButton} onClick={onPrev}>← 1本前</button>
          )}
          {result.hasNext && (
            <button style={styles.navButton} onClick={onNext}>1本後 →</button>
          )}
        </div>
      </div>
    );
  } else {
    if (!result.jr) {
      const direction = skipCount > 0 ? 'これ以上後の' : skipCount < 0 ? 'これより前の' : '';
      return (
        <div style={styles.noResult}>
          <div style={styles.noResultIcon}>—</div>
          <p>{fmt(arriveMin)}以降、{direction}この方向のJRが見つかりませんでした。</p>
        </div>
      );
    }
    const wait = result.jr - arriveMin;
    const missedConnection = wait < MIN_TRANSFER;
    return (
      <div style={styles.resultBox}>
        {skipCount !== 0 && (
          <div style={styles.skipBadge}>{skipCount > 0 ? `${skipCount}本後` : `${-skipCount}本前`}の候補</div>
        )}
        <div style={styles.resultLine}>
          <span style={styles.resultBadge}>バス到着</span>
          <span style={styles.resultTime}>{fmt(arriveMin)}</span>
        </div>
        <div style={styles.arrow}>↓ 待ち時間 約{wait}分</div>
        <div style={styles.resultLine}>
          <span style={styles.resultBadge}>JR乗車</span>
          <span style={styles.resultTime}>{fmt(result.jr)}</span>
        </div>
        {missedConnection && (
          <div style={styles.warningBox}>
            ⚠ この時刻ではすでに発車済み、または乗換に間に合いません。参考情報としてご覧ください。
          </div>
        )}
        <div style={styles.navRow}>
          {result.hasPrev && (
            <button style={styles.navButton} onClick={onPrev}>← 1本前</button>
          )}
          {result.hasNext && (
            <button style={styles.navButton} onClick={onNext}>1本後 →</button>
          )}
        </div>
      </div>
    );
  }
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#F3F1EB',
    fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif",
    padding: '32px 16px',
    color: '#2B2A26',
  },
  container: {
    maxWidth: 480,
    margin: '0 auto',
  },
  header: {
    marginBottom: 28,
  },
  kicker: {
    fontSize: 13,
    letterSpacing: 1,
    color: '#4C7A5E',
    fontWeight: 700,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    lineHeight: 1.35,
    fontWeight: 800,
    margin: '0 0 10px 0',
    color: '#1F2E22',
  },
  subtitle: {
    fontSize: 14,
    color: '#65605A',
    margin: 0,
    lineHeight: 1.6,
  },
  card: {
    background: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #E7E3D9',
  },
  resultCard: {
    background: '#1F2E22',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    color: '#F3F1EB',
  },
  resultDirRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.15)',
  },
  resultDirLabel: {
    fontSize: 13,
    opacity: 0.7,
    marginRight: 4,
  },
  resultDirButton: {
    padding: '7px 12px',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.3)',
    background: 'transparent',
    color: '#F3F1EB',
    fontSize: 13,
    cursor: 'pointer',
  },
  resultDirButtonActive: {
    background: '#4C7A5E',
    borderColor: '#4C7A5E',
    color: '#FFFFFF',
    fontWeight: 700,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 14,
    opacity: 0.75,
  },
  stepLabel2: {
    fontSize: 13,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 12,
    opacity: 0.75,
  },
  timeGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeChip: {
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid #D8D3C6',
    background: '#FBFAF7',
    fontSize: 16,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    color: '#2B2A26',
  },
  timeChipActive: {
    background: '#1F2E22',
    borderColor: '#1F2E22',
    color: '#FFFFFF',
  },
  emptyTimes: {
    fontSize: 13,
    color: '#8C877D',
    padding: '8px 0',
  },
  optionGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  optionButton: {
    textAlign: 'left',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #E7E3D9',
    background: '#FBFAF7',
    fontSize: 14,
    cursor: 'pointer',
    color: '#2B2A26',
    transition: 'all 0.15s',
  },
  optionButtonActive: {
    background: '#4C7A5E',
    borderColor: '#4C7A5E',
    color: '#FFFFFF',
    fontWeight: 700,
  },
  dirRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dirLabel: {
    fontSize: 13,
    color: '#65605A',
    marginRight: 4,
  },
  dirButton: {
    padding: '7px 12px',
    borderRadius: 20,
    border: '1px solid #D8D3C6',
    background: '#FBFAF7',
    fontSize: 13,
    cursor: 'pointer',
  },
  dirButtonActive: {
    background: '#2B2A26',
    borderColor: '#2B2A26',
    color: '#fff',
    fontWeight: 700,
  },
  resultBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  resultLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  resultBadge: {
    fontSize: 12,
    background: 'rgba(255,255,255,0.12)',
    padding: '3px 8px',
    borderRadius: 6,
    fontWeight: 700,
  },
  resultTime: {
    fontSize: 26,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  resultSub: {
    fontSize: 13,
    opacity: 0.75,
  },
  arrow: {
    fontSize: 13,
    opacity: 0.7,
    margin: '6px 0 6px 4px',
  },
  noResult: {
    textAlign: 'center',
    padding: '20px 0',
  },
  warningBox: {
    marginTop: 12,
    padding: '10px 12px',
    background: 'rgba(217,119,87,0.18)',
    border: '1px solid rgba(217,119,87,0.4)',
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.6,
  },
  skipBadge: {
    fontSize: 11.5,
    fontWeight: 700,
    color: 'rgba(243,241,235,0.65)',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  navRow: {
    display: 'flex',
    gap: 8,
    marginTop: 16,
  },
  navButton: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.3)',
    background: 'rgba(255,255,255,0.08)',
    color: '#F3F1EB',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  noResultIcon: {
    fontSize: 28,
    marginBottom: 8,
    opacity: 0.5,
  },
  footer: {
    fontSize: 11.5,
    color: '#8C877D',
    lineHeight: 1.7,
    marginTop: 24,
  },
  footerNote: {
    marginTop: 6,
  },
};
