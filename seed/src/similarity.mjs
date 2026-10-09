// 姓名相似度：归一化后的编辑距离比，范围 0–1。
// 合同没有规定算法（企划书只给了 0.85 这个阈值），这里选最朴素的一种。
// 造数据时在通过(≥0.90)与不通过(≤0.60)之间留空档，换算法也不容易翻转。
export const normalizeName = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim();

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function similarity(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  const len = Math.max(x.length, y.length);
  if (len === 0) return 1;
  return 1 - levenshtein(x, y) / len;
}
