// ============================================================
// 司会者画面・スクリーン画面で共通の処理
// ============================================================
import { ref, get, child, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const OPTION_LABELS = 'ABCD';

// 本番用の初期問題。選択肢と1〜6問目の正解は司会者画面で入力する
const DEFAULT_QUESTION_TEXTS = [
  ['【過去編】新郎の子どもの頃の将来の夢は？', false],
  ['【過去編】新婦の子どもの頃の将来の夢は？', false],
  ['【過去編】新郎の初めてのアルバイトは？', false],
  ['【過去編】新婦の初めてのアルバイトは？', false],
  ['【現在編】新郎の家での担当家事は？', false],
  ['【現在編】新婦の家での担当家事は？', false],
  ['【未来編】10年後、新郎はどんな見た目になっている？', true],
  ['【未来編】10年後、新婦が休日に夢中になっている趣味は？', true]
];

// correctIndex: 正解の番号（未設定・正解なしは null）、noCorrect: 「正解なし」を選んだ問題
export function defaultQuestions() {
  return DEFAULT_QUESTION_TEXTS.map(([text, noCorrect]) => ({
    id: newQuestionId(), text, options: ['', '', '', ''], correctIndex: null, noCorrect
  }));
}

// 「【過去編】…」の先頭ラベルを分ける
const CATEGORY_CLASSES = { '過去編': 'cat-past', '現在編': 'cat-present', '未来編': 'cat-future' };
export function splitCategory(text) {
  const m = String(text || '').match(/^【(.+?)】\s*/);
  if (!m) return { category: '', categoryClass: '', body: text || '' };
  return { category: m[1], categoryClass: CATEGORY_CLASSES[m[1]] || 'cat-other', body: text.slice(m[0].length) };
}

export function hasCorrect(q) {
  return !!q && (q.correctIndex === 0 || q.correctIndex > 0);
}

// votes/{qIndex} の中身 → [A票, B票, C票, D票]
export function tallyVotes(votes) {
  const counts = [0, 0, 0, 0];
  Object.values(votes || {}).forEach(v => { if (v >= 0 && v <= 3) counts[v]++; });
  return counts;
}

// 1点もらえる選択肢の番号。正解ありならその1つ、正解なし（未来編など）なら最多票の選択肢（同数はすべて）。
// 正解が未設定の問題や、まだ投票がない正解なしの問題は空配列
export function scoringOptions(q, counts) {
  if (hasCorrect(q)) return [q.correctIndex];
  if (!q || !q.noCorrect) return [];
  const max = Math.max(...counts);
  if (max === 0) return [];
  return counts.map((c, i) => (c === max ? i : -1)).filter(i => i >= 0);
}

// 得点（正解 or 最多票で1点）で並べたランキング（同点は同順位）
export async function computeRanking(db, questions, participants) {
  const scores = {};
  Object.keys(participants).forEach(uid => { scores[uid] = 0; });

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    if (!hasCorrect(q) && !q?.noCorrect) continue; // 正解が未設定の問題はスキップ
    const snap = await get(child(ref(db), `votes/${qi}`));
    const votes = snap.val() || {};
    const winners = scoringOptions(q, tallyVotes(votes));
    Object.entries(votes).forEach(([uid, v]) => {
      if (winners.includes(v)) scores[uid] = (scores[uid] || 0) + 1;
    });
  }

  const rows = Object.keys(participants).map(uid => ({
    nickname: participants[uid].nickname || '名無し',
    score: scores[uid] || 0
  }));
  rows.sort((a, b) => b.score - a.score);

  let rank = 0, prevScore = null;
  rows.forEach((r, i) => {
    if (r.score !== prevScore) { rank = i + 1; prevScore = r.score; }
    r.rank = rank;
  });
  return rows;
}

// 親族は景品ランキングの対象外。group がない参加者はゲストとして扱う
export function isFamily(p) {
  return p?.group === 'family';
}

export function filterParticipants(participants, family) {
  return Object.fromEntries(Object.entries(participants || {}).filter(([, p]) => isFamily(p) === family));
}

// 結果公開後に映す写真の順番。未来編は最多票の選択肢の写真（同数ならすべて）、それ以外は登録順にすべて
function photoQueue(q, votes, thumbs) {
  const keys = Object.keys(thumbs || {}).sort();
  if (q?.noCorrect) {
    return scoringOptions(q, tallyVotes(votes))
      .filter(i => keys[i])
      .map(i => ({ key: keys[i], label: `写真を映す（${OPTION_LABELS[i]}）` }));
  }
  return keys.map((key, i) => ({ key, label: keys.length > 1 ? `写真を映す（${i + 1}/${keys.length}枚目）` : '写真を映す' }));
}

// 司会者の「次へ」ボタンで次に行う操作を、今の進行状況から決める
export function nextHostStep({ session, questions, votes, thumbs, familyCount }) {
  if (!questions?.length) return { action: 'none', label: '問題がありません' };
  const qi = session?.currentQuestionIndex || 0;
  const q = questions[qi];
  const status = session?.status || 'waiting';
  const scr = session?.screen || {};

  if (status === 'waiting') return { action: 'start', label: '投票受付開始' };
  if (status === 'voting') return { action: 'close', label: '締切' };
  if (status === 'closed') return { action: 'reveal', label: '結果を公開' };

  const queue = photoQueue(q, votes, thumbs);
  const shown = scr.mode === 'photo' && scr.qid === q?.id ? queue.findIndex(p => p.key === scr.photoKey) : -1;
  if (shown + 1 < queue.length) return { action: 'photo', label: queue[shown + 1].label, qid: q.id, photoKey: queue[shown + 1].key };

  if (qi + 1 < questions.length) return { action: 'nextQuestion', label: `次の問題へ（第${qi + 2}問）` };
  if (scr.mode !== 'ranking' && scr.mode !== 'familyRanking') return { action: 'ranking', label: 'ランキング発表' };
  if (scr.mode === 'ranking' && familyCount > 0) return { action: 'familyRanking', label: '親族ランキング' };
  return { action: 'none', label: 'すべて終了しました' };
}

export function rankMedal(rank) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}位`;
}

export function newQuestionId() {
  return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 画像ファイルを縮小してJPEGのdataURLにする
export function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

// Firebaseとの接続状態を 'connecting'（開いた直後）/ 'online' / 'offline'（一度つながった後に切れた）で知らせる。
// 切れている間の書き込みは端末にたまり、つながり直すと自動で送られる
export function watchConnection(db, onChange) {
  let everConnected = false;
  onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === true) { everConnected = true; onChange('online'); }
    else onChange(everConnected ? 'offline' : 'connecting');
  });
}

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}
