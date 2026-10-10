// 成员搜索的匹配规则。姓名是全大写 ASCII，带 BIN / BINTI / A/L / A/P 这类连接词（A-Z、空格、/ ' . -）。

// 去掉标点（A/L → AL）、折叠空格、转小写：被搜的姓名用这个形式
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// 查询只按空白拆词，词内的标点直接去掉：a/l → [al]（与 al 完全等价），「a l」→ [a, l]（两个词，范围更宽，本来如此）。
// 不能把 / 当分隔符：那样 a/l 会变成 [a, l]，命中所有同时含 a 和 l 的名字（如 SITI AISHAH BINTI ABDULLAH）
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

/**
 * 每个词都要出现在姓名里，顺序不限；空查询匹配所有人。
 * 刻意不做同义词展开（BIN ≠ B.、BT.）：规则简单，用户看得懂为什么没命中。
 */
export function matchesQuery(fullName: string, query: string): boolean {
  const terms = words(query);
  if (terms.length === 0) return true;
  const haystack = squash(fullName);
  return terms.every((t) => haystack.includes(t));
}
