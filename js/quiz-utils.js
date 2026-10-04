// ============================================================
// 司会者画面・スクリーン画面で共通の処理
// ============================================================
import { ref, get, child } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const OPTION_LABELS = 'ABCD';

export function hasCorrect(q) {
  return !!q && (q.correctIndex === 0 || q.correctIndex > 0);
}

// votes/{qIndex} の中身 → [A票, B票, C票, D票]
export function tallyVotes(votes) {
  const counts = [0, 0, 0, 0];
  Object.values(votes || {}).forEach(v => { if (v >= 0 && v <= 3) counts[v]++; });
  return counts;
}

// 正解数で並べたランキング（同点は同順位）
export async function computeRanking(db, questions, participants) {
  const scores = {};
  Object.keys(participants).forEach(uid => { scores[uid] = 0; });

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    if (!hasCorrect(q)) continue; // 正解なしの問題はスキップ
    const snap = await get(child(ref(db), `votes/${qi}`));
    Object.entries(snap.val() || {}).forEach(([uid, v]) => {
      if (v === q.correctIndex) scores[uid] = (scores[uid] || 0) + 1;
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

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}
