// 映射层：schema.sql 的 snake_case 列 → Firestore 的 camelCase 字段，以及哪些字段是 Firestore Timestamp。
// 合同没有规定 Firestore 字段名，camelCase 是临时约定（与企划书 §8.9 的 titleNo、ruleResults 一致）。
// 合同定下后，字段名和类型只在这个文件里改。

export const toCamel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// 只转第一层键：fields{} 里 "land_title.lot_no" 这类键、paramsUsed 里 tol_pct 这类键要保持原样
export function camelKeys(row) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
}

// 这些字段在 JSON 里是 ISO 字符串，灌入模拟器时转成 Firestore Timestamp。
// 日期列（validUntil、leaseExpiry、expiryDate 等）不在此列，保持 YYYY-MM-DD 字符串。
export const TIMESTAMP_FIELDS = new Set([
  'createdAt', 'updatedAt', 'lastLoginAt', 'geometryRecordedAt', 'lastAssessedAt',
  'capturedAt', 'extractedAt', 'startedAt', 'finishedAt', 'confirmedAt',
]);

// 灌入时哪些字符串要当 Timestamp：键名在注册表里，且值是完整的 ISO 时间
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Firestore 能原样写入的检查：没有 undefined / NaN / Infinity，没有数组直接嵌套数组
export function firestoreProblems(value, path = '$') {
  const problems = [];
  const walk = (v, p, parentIsArray) => {
    if (v === undefined) problems.push(`${p}: undefined`);
    else if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${p}: 非有限数字`);
    else if (Array.isArray(v)) {
      if (parentIsArray) problems.push(`${p}: 数组直接嵌套数组`);
      v.forEach((x, i) => walk(x, `${p}[${i}]`, true));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === '') problems.push(`${p}: 空键`);
        walk(x, `${p}.${k}`, false);
      }
    }
  };
  walk(value, path, false);
  return problems;
}

// ruleResults 里的 meta 只给生成器内部用，不进输出
export const stripMeta = (ruleResult) => {
  const { meta, ...rest } = ruleResult;
  return rest;
};
