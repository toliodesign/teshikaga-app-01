import React, { useState, useMemo, useEffect, useRef } from 'react';

// ============================================================
// 「次の1本」速報画面
// JR釧網本線 3駅（摩周駅・美留和駅・川湯温泉駅）が対象。
// データ出典：Yahoo!路線情報のJR釧網本線時刻表（利用者提供・確認済み）
// 平日・土曜・日曜祝日ですべて同じダイヤであることを確認済み。
// ============================================================

const toMin = (h, m) => h * 60 + m;
function fmt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// 3駅を、実際の路線順（川湯温泉 ⇔ 美留和 ⇔ 摩周）に並べる。
// 隣接駅の「左右」は、この並び順そのものを使う。
// busStopKeyは、その駅にいちばん近い美留和線バス停への対応キー（BUS_STOPSのキーと一致させる）。
const STATIONS = [
  {
    key: 'kawayu',
    name: '川湯温泉',
    ruby: 'かわゆおんせん',
    kana: 'KAWAYU',
    color: '#EE0025',
    busStopKey: 'kawayu',
    unkouUrl: 'https://www3.jrhokkaido.co.jp/webunkou/timetable.html?id=392',
    // 上り = 釧路方面、下り = 網走方面
    kushiro: [toMin(6, 11), toMin(8, 20), toMin(11, 59), toMin(16, 55), toMin(18, 18)],
    abashiri: [toMin(8, 20), toMin(10, 29), toMin(15, 51), toMin(18, 18)],
  },
  {
    key: 'biruwa',
    name: '美留和',
    ruby: 'びるわ',
    kana: 'BIRUWA',
    color: '#2F813F',
    busStopKey: 'biruwa',
    unkouUrl: 'https://www3.jrhokkaido.co.jp/webunkou/timetable.html?id=391',
    kushiro: [toMin(6, 18), toMin(8, 28), toMin(12, 7), toMin(17, 3), toMin(18, 27)],
    abashiri: [toMin(8, 9), toMin(10, 21), toMin(15, 43), toMin(18, 10), toMin(20, 54)],
  },
  {
    key: 'mashu',
    name: '摩周',
    ruby: 'ましゅう',
    kana: 'MASHU',
    color: '#0098DF',
    busStopKey: 'mashu',
    unkouUrl: 'https://www3.jrhokkaido.co.jp/webunkou/timetable.html?id=390',
    kushiro: [toMin(6, 28), toMin(8, 37), toMin(12, 16), toMin(17, 13), toMin(19, 1), toMin(19, 50)],
    abashiri: [toMin(8, 0), toMin(10, 12), toMin(15, 34), toMin(18, 1), toMin(20, 45)],
  },
];

// ============================================================
// 阿寒バス 美留和線（データ出典：弟子屈バスマップ 令和8年4月発行）
// 全曜日（平日・土曜・日曜祝日）同じダイヤで運行。
// JR3駅の最寄りバス停：
//   川湯温泉駅 ⇔ 「川湯駅」(約12m、実質同一地点)
//   摩周駅     ⇔ 「摩周駅前」(約24m、実質同一地点)
//   美留和駅   ⇔ 「美留和」(バス停の座標は未確認だが、路線図・駅名の対応から同一エリアと判断)
// ============================================================
const BUS_STOPS = {
  kawayu: {
    stopName: '川湯駅',
    // 便番号: 時刻。方向はBUS_TRIP_DIRECTIONで別管理。
    times: { 92: toMin(7, 33), 94: toMin(9, 13), 96: toMin(11, 18), 95: toMin(14, 0), 97: toMin(16, 30), 99: toMin(19, 13) },
  },
  biruwa: {
    stopName: '美留和',
    times: { 92: toMin(7, 40), 94: toMin(9, 20), 96: toMin(11, 25), 95: toMin(13, 53), 97: toMin(16, 23), 99: toMin(19, 6) },
  },
  mashu: {
    stopName: '摩周駅前',
    times: {
      92: toMin(8, 20), 94: toMin(10, 0), 91: toMin(10, 15), 96: toMin(12, 5),
      93: toMin(12, 20), 95: toMin(13, 20), 98: toMin(15, 40), 97: toMin(15, 50), 99: toMin(18, 47),
    },
  },
};

// 各便番号の進行方向。to_mashu = 大鵬相撲記念館前→摩周方面ゆき／to_kawayu = 摩周方面→大鵬相撲記念館前方面ゆき
const BUS_TRIP_DIRECTION = {
  92: 'to_mashu', 94: 'to_mashu', 96: 'to_mashu', 98: 'to_mashu',
  91: 'to_kawayu', 93: 'to_kawayu', 95: 'to_kawayu', 97: 'to_kawayu', 99: 'to_kawayu',
};
const BUS_DIRECTION_LABEL = {
  to_mashu: '摩周方面ゆき',
  to_kawayu: '大鵬相撲記念館前方面ゆき',
};
// 91・93・98便は「摩周駅前⇔開発前」間のみの区間便で、美留和・川湯駅には行かない
// （BUS_STOPSのkawayu・biruwaのtimesに91・93・98が含まれていないことで、自動的に反映されている）
const BUS_SECTION_ONLY_TRIPS = ['91', '93', '98'];

// 指定バス停の、方向ごとに分かれた「次の1本」を返す。
// 戻り値: { to_mashu: {tripId, time} | null, to_kawayu: {tripId, time} | null }
function nextBusByDirection(busStopKey, nowMin) {
  const stop = BUS_STOPS[busStopKey];
  const result = { to_mashu: null, to_kawayu: null };
  if (!stop) return result;
  Object.entries(stop.times).forEach(([tripId, time]) => {
    const dir = BUS_TRIP_DIRECTION[tripId];
    if (time < nowMin) return;
    if (!result[dir] || time < result[dir].time) {
      result[dir] = { tripId, time };
    }
  });
  return result;
}

// 指定バス停の、一日全便を方向別・時刻順に並べたリストを返す。
function allBusTimesByDirection(busStopKey) {
  const stop = BUS_STOPS[busStopKey];
  const grouped = { to_mashu: [], to_kawayu: [] };
  if (!stop) return grouped;
  Object.entries(stop.times).forEach(([tripId, time]) => {
    const dir = BUS_TRIP_DIRECTION[tripId];
    grouped[dir].push({ tripId, time });
  });
  grouped.to_mashu.sort((a, b) => a.time - b.time);
  grouped.to_kawayu.sort((a, b) => a.time - b.time);
  return grouped;
}

// 現在時刻（分）を取得。テスト用に、URLやここを直接書き換えて確認できるようにしてある。
function useNowMinutes() {
  const [now, setNow] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    }, 15000); // 15秒ごとに再判定すれば速報用途としては十分
    return () => clearInterval(id);
  }, []);
  return now;
}

// 現在時刻以降で最初に来る時刻を1つ返す。無ければnull（本日はもう無い）。
function nextTrain(times, nowMin) {
  const sorted = times.slice().sort((a, b) => a - b);
  const found = sorted.find(t => t >= nowMin);
  return found != null ? found : null;
}

export default function App() {
  const nowMin = useNowMinutes();
  const [index, setIndex] = useState(1); // 初期表示は美留和駅
  const station = STATIONS[index];

  const leftStation = index > 0 ? STATIONS[index - 1] : null;
  const rightStation = index < STATIONS.length - 1 ? STATIONS[index + 1] : null;

  const kushiroNext = useMemo(() => nextTrain(station.kushiro, nowMin), [station, nowMin]);
  const abashiriNext = useMemo(() => nextTrain(station.abashiri, nowMin), [station, nowMin]);

  // ---- スワイプ操作 ----
  // 「前の駅名」「今の駅名」「次の駅名」の3枚を横に並べておき、
  // 指の動きに合わせてその3枚全体を左右に動かす。指を離した時点の位置に応じて、
  // 隣の駅に完全に切り替えるか、元の位置に戻すかを決める。
  // パネル1枚分の実際の幅（px）は表示中に測って持っておく（画面幅によって変わるため）。
  const trackWrapRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(340);
  useEffect(() => {
    const measure = () => {
      if (trackWrapRef.current) {
        setPanelWidth(trackWrapRef.current.offsetWidth);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const touchStartX = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const SWIPE_THRESHOLD = panelWidth * 0.25;

  const goPrev = () => setIndex(i => Math.max(0, i - 1));
  const goNext = () => setIndex(i => Math.min(STATIONS.length - 1, i + 1));

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    setIsDragging(true);
  };
  const handleTouchMove = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    // 左端・右端では、それ以上動かない方向への引っ張りを弱く見せる（ゴムのような抵抗感）
    if ((index === 0 && dx > 0) || (index === STATIONS.length - 1 && dx < 0)) {
      setDragOffset(dx * 0.3);
    } else {
      setDragOffset(dx);
    }
  };
  const handleTouchEnd = () => {
    if (dragOffset <= -SWIPE_THRESHOLD && rightStation) {
      goNext();
    } else if (dragOffset >= SWIPE_THRESHOLD && leftStation) {
      goPrev();
    }
    setIsDragging(false);
    setDragOffset(0);
    touchStartX.current = null;
  };

  // キーボード操作（PCでの確認用）
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- タップで全時刻ポップアップ ----
  // kind: 'jr' | 'bus'。jrはdirectionに'kushiro'|'abashiri'、busは'to_mashu'|'to_kawayu'を使う。
  const [popup, setPopup] = useState(null);
  const closePopup = () => setPopup(null);

  // 現在の駅に対応するバス停の「次の1本」（方向ごと）
  const busNext = useMemo(
    () => nextBusByDirection(station.busStopKey, nowMin),
    [station, nowMin]
  );
  const busStopName = BUS_STOPS[station.busStopKey]?.stopName || '';

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.currentTimeRow}>{fmt(nowMin)} 現在</div>

        <div
          style={styles.board}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* 駅名パネル：前・現在・次の3枚を横に並べ、ドラッグ量に応じて全体をスライドさせる */}
          <div style={styles.stationTrack} ref={trackWrapRef}>
            <div
              style={{
                display: 'flex',
                width: panelWidth * 3,
                transform: `translateX(${-panelWidth + dragOffset}px)`,
                transition: isDragging ? 'none' : 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <StationPanel station={leftStation} width={panelWidth} />
              <StationPanel station={station} width={panelWidth} />
              <StationPanel station={rightStation} width={panelWidth} />
            </div>
          </div>

          {/* 隣駅ヒント（タップでも切り替えられる） */}
          <div style={styles.neighborRow}>
            <button
              style={{ ...styles.neighborButton, visibility: leftStation ? 'visible' : 'hidden' }}
              onClick={goPrev}
              aria-label="前の駅へ"
            >
              <span style={styles.neighborArrow}>←</span>
              <span style={styles.neighborName}>{leftStation ? leftStation.name : ''}</span>
            </button>
            <button
              style={{ ...styles.neighborButton, visibility: rightStation ? 'visible' : 'hidden' }}
              onClick={goNext}
              aria-label="次の駅へ"
            >
              <span style={styles.neighborName}>{rightStation ? rightStation.name : ''}</span>
              <span style={styles.neighborArrow}>→</span>
            </button>
          </div>

          {/* ページドット */}
          <div style={styles.dotsRow}>
            {STATIONS.map((s, i) => (
              <span
                key={s.key}
                style={{ ...styles.dot, ...(i === index ? styles.dotActive : {}) }}
              />
            ))}
          </div>

          {/* JR方面別 次の1本 */}
          <div style={styles.jrSection}>
            <div style={styles.jrLabelRow}>
              <span style={styles.jrBadge}>JR</span>
              <span style={styles.jrLine}>釧網本線</span>
            </div>

            <div style={styles.directionRow}>
              <div style={{ ...styles.directionCol, ...styles.directionColJr }} onClick={() => setPopup({ kind: 'jr', direction: 'abashiri' })}>
                <div style={styles.directionLabel}>← 網走方面</div>
                {abashiriNext != null ? (
                  <div style={styles.nextTime}>{fmt(abashiriNext)}</div>
                ) : (
                  <div style={styles.noMore}>本日終了</div>
                )}
                <div style={styles.tapHint}>タップで全便表示</div>
              </div>
              <div style={{ ...styles.directionCol, ...styles.directionColJr }} onClick={() => setPopup({ kind: 'jr', direction: 'kushiro' })}>
                <div style={styles.directionLabel}>釧路方面 →</div>
                {kushiroNext != null ? (
                  <div style={styles.nextTime}>{fmt(kushiroNext)}</div>
                ) : (
                  <div style={styles.noMore}>本日終了</div>
                )}
                <div style={styles.tapHint}>タップで全便表示</div>
              </div>
            </div>

            <a
              href={station.unkouUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.unkouButton}
            >
              運行情報
              <span style={styles.externalIcon} aria-hidden="true">↗</span>
            </a>
          </div>

          {/* 阿寒バス 美留和線 方面別 次の1本 */}
          <div style={styles.busSection}>
            <div style={styles.busLabelRow}>
              <span style={styles.busBadge}>BUS</span>
              <span style={styles.busLine}>美留和線（{busStopName}）</span>
            </div>

            <div style={styles.directionRow}>
              <div style={{ ...styles.directionCol, ...styles.directionColBus }} onClick={() => setPopup({ kind: 'bus', direction: 'to_kawayu' })}>
                <div style={styles.busDirectionLabel}>← 大鵬相撲記念館方面</div>
                {busNext.to_kawayu ? (
                  <>
                    <div style={styles.nextTime}>{fmt(busNext.to_kawayu.time)}</div>
                    <div style={styles.tripIdLabel}>{busNext.to_kawayu.tripId}便</div>
                  </>
                ) : (
                  <div style={styles.noMore}>本日終了</div>
                )}
                <div style={styles.tapHintOnBus}>タップで全便表示</div>
              </div>
              <div style={{ ...styles.directionCol, ...styles.directionColBus }} onClick={() => setPopup({ kind: 'bus', direction: 'to_mashu' })}>
                <div style={styles.busDirectionLabel}>摩周方面 →</div>
                {busNext.to_mashu ? (
                  <>
                    <div style={styles.nextTime}>{fmt(busNext.to_mashu.time)}</div>
                    <div style={styles.tripIdLabel}>{busNext.to_mashu.tripId}便</div>
                  </>
                ) : (
                  <div style={styles.noMore}>本日終了</div>
                )}
                <div style={styles.tapHintOnBus}>タップで全便表示</div>
              </div>
            </div>

            {(BUS_SECTION_ONLY_TRIPS.includes(busNext.to_kawayu?.tripId) ||
              BUS_SECTION_ONLY_TRIPS.includes(busNext.to_mashu?.tripId)) && (
              <div style={styles.busWarning}>
                ⚠ 表示中の便には、摩周駅前⇔開発前間のみの区間便が含まれます。美留和・川湯駅方面へは行きません。
              </div>
            )}
          </div>
        </div>

        {popup && popup.kind === 'jr' && (
          <TimetablePopup
            station={station}
            direction={popup.direction}
            nowMin={nowMin}
            onClose={closePopup}
          />
        )}

        {popup && popup.kind === 'bus' && (
          <BusTimetablePopup
            busStopKey={station.busStopKey}
            direction={popup.direction}
            nowMin={nowMin}
            onClose={closePopup}
          />
        )}

        <div style={styles.stationSwitcher}>
          {STATIONS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setIndex(i)}
              style={{
                ...styles.switcherButton,
                ...(i === index ? styles.switcherButtonActive : {}),
              }}
            >
              {s.name}
            </button>
          ))}
        </div>

        <p style={styles.footerNote}>
          出典：JR北海道 釧網本線時刻表（Yahoo!路線情報より確認）／阿寒バス 美留和線時刻表（弟子屈バスマップ 令和8年4月発行）。いずれも平日・土曜・日曜祝日とも同じダイヤです。
        </p>

        <div style={styles.creditRow}>
          <img src="/logo_toliodesign.png" alt="tolio design" style={styles.creditLogo} />
          <span style={styles.creditText}>制作：tolio design</span>
        </div>
      </div>
    </div>
  );
}

// 駅名パネル1枚分。stationがnull（両端の外側）の場合は空欄にする。
function StationPanel({ station, width }) {
  return (
    <div style={{ ...styles.stationNameWrap, width, flexShrink: 0 }}>
      {station && (
        <div style={styles.stationNameBox}>
          <div style={styles.stationRuby}>{station.ruby}</div>
          <div style={{ ...styles.stationName, color: station.color }}>{station.name}</div>
          <div style={styles.stationKana}>{station.kana}</div>
        </div>
      )}
    </div>
  );
}

// 長押しで開く、その方面の一日全便を縦に並べたポップアップ。
// 現在時刻より前の便は薄く表示し、次に来る1本には目印を付ける。
function TimetablePopup({ station, direction, nowMin, onClose }) {
  const times = (direction === 'kushiro' ? station.kushiro : station.abashiri).slice().sort((a, b) => a - b);
  const nextIndex = times.findIndex(t => t >= nowMin);
  const label = direction === 'kushiro' ? '釧路方面' : '網走方面';

  return (
    <div style={styles.popupOverlay} onClick={onClose}>
      <div style={styles.popupBox} onClick={(e) => e.stopPropagation()}>
        <div style={styles.popupHeader}>
          <div style={styles.popupStationName}>
            <span style={styles.jrBadge}>JR</span>
            {station.name}駅
          </div>
          <div style={styles.popupDirectionLabel}>{label}</div>
        </div>
        <div style={styles.popupList}>
          {times.map((t, i) => (
            <div
              key={i}
              style={{
                ...styles.popupTimeRow,
                ...(i < nextIndex || nextIndex === -1 ? styles.popupTimeRowPast : {}),
              }}
            >
              <span style={styles.popupTime}>{fmt(t)}</span>
              {i === nextIndex && <span style={styles.popupNextBadge}>次の1本</span>}
            </div>
          ))}
        </div>
        <button style={styles.popupCloseButton} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

// バス版の全便ポップアップ。便番号を併記し、区間便には個別に注記を付ける。
function BusTimetablePopup({ busStopKey, direction, nowMin, onClose }) {
  const stop = BUS_STOPS[busStopKey];
  const grouped = allBusTimesByDirection(busStopKey);
  const trips = grouped[direction];
  const nextIndex = trips.findIndex(t => t.time >= nowMin);
  const label = BUS_DIRECTION_LABEL[direction];

  return (
    <div style={styles.popupOverlay} onClick={onClose}>
      <div style={styles.popupBox} onClick={(e) => e.stopPropagation()}>
        <div style={styles.popupHeader}>
          <div style={styles.popupStationName}>
            <span style={styles.busBadge}>BUS</span>
            {stop?.stopName}
          </div>
          <div style={styles.popupDirectionLabel}>{label}</div>
        </div>
        <div style={styles.popupList}>
          {trips.length === 0 && (
            <div style={styles.noTimesInPopup}>この方向の便はありません</div>
          )}
          {trips.map((t, i) => {
            const sectionOnly = BUS_SECTION_ONLY_TRIPS.includes(t.tripId);
            return (
              <div
                key={i}
                style={{
                  ...styles.popupTimeRow,
                  ...(i < nextIndex || nextIndex === -1 ? styles.popupTimeRowPast : {}),
                }}
              >
                <div>
                  <span style={styles.popupTime}>{fmt(t.time)}</span>
                  <span style={styles.popupTripId}>{t.tripId}便</span>
                  {sectionOnly && <div style={styles.popupSectionNote}>※開発前までの区間便</div>}
                </div>
                {i === nextIndex && <span style={styles.popupNextBadge}>次の1本</span>}
              </div>
            );
          })}
        </div>
        <button style={styles.popupCloseButton} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#1C2B22',
    fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif",
    padding: '32px 16px',
    color: '#F5F2EA',
    display: 'flex',
    justifyContent: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 380,
  },
  currentTimeRow: {
    textAlign: 'center',
    fontSize: 13,
    color: 'rgba(245,242,234,0.55)',
    marginBottom: 18,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: 0.5,
  },
  board: {
    background: '#F5F2EA',
    borderRadius: 20,
    padding: '28px 20px 24px',
    color: '#1C2B22',
    touchAction: 'pan-y',
    userSelect: 'none',
  },
  stationTrack: {
    overflow: 'hidden',
    width: '100%',
  },
  neighborRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 6,
  },
  neighborButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    padding: '6px 4px',
    cursor: 'pointer',
    color: '#8A8578',
    fontSize: 14,
    fontWeight: 600,
  },
  neighborArrow: {
    fontSize: 14,
    color: '#C94E3F',
  },
  neighborName: {
    whiteSpace: 'nowrap',
  },
  stationNameWrap: {
    textAlign: 'center',
    padding: '14px 0 6px',
  },
  stationNameBox: {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    background: '#FFFFFF',
    borderRadius: 20,
    padding: '14px 28px',
    boxShadow: '0 1px 4px rgba(28,43,34,0.08)',
  },
  stationRuby: {
    fontSize: 13,
    letterSpacing: 3,
    color: '#8A8578',
    fontWeight: 700,
    marginBottom: 2,
  },
  stationName: {
    fontSize: 52,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: 1,
  },
  stationKana: {
    fontSize: 13,
    letterSpacing: 3,
    color: '#8A8578',
    marginTop: 4,
    fontWeight: 700,
  },
  dotsRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    marginBottom: 22,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#D8D3C6',
  },
  dotActive: {
    background: '#C94E3F',
    width: 16,
  },
  jrSection: {
    background: 'linear-gradient(155deg, #EDEFF0 0%, #E1E4E6 45%, #E9EBEC 70%, #DADDDF 100%)',
    border: '1px solid #D2D5D7',
    borderRadius: 14,
    marginTop: 22,
    padding: 16,
  },
  jrLabelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 16,
  },
  jrBadge: {
    fontSize: 12,
    fontWeight: 800,
    color: '#FFFFFF',
    background: '#03C13D',
    borderRadius: 5,
    padding: '2px 6px',
  },
  jrLine: {
    fontSize: 19.5,
    color: '#0B3D18',
    fontWeight: 700,
  },
  unkouButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    padding: '11px 0',
    background: '#03C13D',
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 700,
    borderRadius: 10,
    textDecoration: 'none',
  },
  externalIcon: {
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1,
  },
  busSection: {
    background: '#E3F5F6',
    border: '1px solid #C8F1F3',
    borderRadius: 14,
    marginTop: 22,
    padding: 16,
  },
  busLabelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 16,
  },
  busBadge: {
    fontSize: 12,
    fontWeight: 800,
    color: '#FFFFFF',
    background: '#3FB696',
    borderRadius: 5,
    padding: '2px 6px',
  },
  busLine: {
    fontSize: 19.5,
    color: '#1F7A6E',
    fontWeight: 700,
  },
  busDirectionLabel: {
    display: 'inline-block',
    fontSize: 13,
    color: '#6B3A2E',
    background: '#FBEFB0',
    fontWeight: 800,
    letterSpacing: 0.2,
    padding: '3px 9px',
    borderRadius: 5,
    marginBottom: 10,
  },
  tripIdLabel: {
    fontSize: 11,
    color: '#5C8A83',
    fontWeight: 700,
    marginTop: 2,
  },
  busWarning: {
    marginTop: 14,
    padding: '10px 12px',
    background: 'rgba(201,78,63,0.18)',
    border: '1px solid rgba(201,78,63,0.4)',
    borderRadius: 10,
    fontSize: 11.5,
    lineHeight: 1.6,
    color: '#8A4237',
  },
  directionRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 10,
  },
  directionCol: {
    flex: 1,
    textAlign: 'center',
    padding: '10px 6px',
    cursor: 'pointer',
    borderRadius: 12,
    transition: 'background 0.15s',
  },
  directionColJr: {
    background: '#D7DADC',
  },
  directionColBus: {
    background: '#CBEAEC',
  },
  directionLabel: {
    display: 'inline-block',
    fontSize: 13,
    color: '#6B3A2E',
    background: '#FBEFB0',
    fontWeight: 800,
    letterSpacing: 0.2,
    padding: '3px 9px',
    borderRadius: 5,
    marginBottom: 10,
  },
  nextTime: {
    fontSize: 28,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
    color: '#B34129',
  },
  noMore: {
    fontSize: 15,
    color: '#6E6A62',
    fontWeight: 700,
    padding: '10px 0',
  },
  tapHint: {
    fontSize: 10.5,
    color: '#6B8577',
    marginTop: 8,
    fontWeight: 600,
  },
  tapHintOnBus: {
    fontSize: 10.5,
    color: '#5A6E6B',
    marginTop: 8,
    fontWeight: 600,
  },
  popupOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(28,43,34,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 100,
  },
  popupBox: {
    background: '#F5F2EA',
    borderRadius: 20,
    padding: '22px 22px 18px',
    width: '100%',
    maxWidth: 300,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    color: '#1C2B22',
  },
  popupHeader: {
    marginBottom: 4,
  },
  popupStationName: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 20,
    fontWeight: 800,
  },
  popupDirectionLabel: {
    display: 'inline-block',
    fontSize: 16,
    color: '#6B3A2E',
    background: '#FBEFB0',
    fontWeight: 800,
    padding: '5px 12px',
    borderRadius: 5,
    marginTop: 8,
    marginBottom: 14,
  },
  popupList: {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    borderTop: '1px solid #E2DDCF',
    paddingTop: 4,
  },
  popupTimeRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 4px',
    borderBottom: '1px solid #E2DDCF',
  },
  popupTimeRowPast: {
    opacity: 0.35,
  },
  popupTime: {
    fontSize: 19,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  popupTripId: {
    fontSize: 12,
    color: '#8A8578',
    fontWeight: 700,
    marginLeft: 8,
  },
  popupSectionNote: {
    fontSize: 10.5,
    color: '#C94E3F',
    fontWeight: 700,
    marginTop: 2,
  },
  noTimesInPopup: {
    fontSize: 13,
    color: '#8A8578',
    padding: '16px 4px',
    textAlign: 'center',
  },
  popupNextBadge: {
    fontSize: 11,
    fontWeight: 800,
    color: '#C94E3F',
    letterSpacing: 0.5,
  },
  popupCloseButton: {
    marginTop: 16,
    padding: '11px 0',
    borderRadius: 12,
    border: 'none',
    background: '#1C2B22',
    color: '#F5F2EA',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  stationSwitcher: {
    display: 'flex',
    gap: 8,
    marginTop: 20,
  },
  switcherButton: {
    flex: 1,
    padding: '10px 6px',
    borderRadius: 10,
    border: '1px solid rgba(245,242,234,0.25)',
    background: 'transparent',
    color: 'rgba(245,242,234,0.7)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  switcherButtonActive: {
    background: '#F5F2EA',
    borderColor: '#F5F2EA',
    color: '#1C2B22',
  },
  footerNote: {
    fontSize: 11,
    color: 'rgba(245,242,234,0.45)',
    textAlign: 'center',
    lineHeight: 1.7,
    marginTop: 20,
  },
  creditRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  creditLogo: {
    width: 16,
    height: 16,
    opacity: 0.75,
  },
  creditText: {
    fontSize: 11,
    color: 'rgba(245,242,234,0.45)',
    letterSpacing: 0.3,
  },
};
