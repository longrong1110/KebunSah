import { Timestamp } from 'firebase/firestore';

/**
 * Firestore 读出来的时间是 Timestamp 对象。组件不能 import firebase/*，所以在这一层统一转成 Date：
 * 递归处理嵌套的对象与数组；其他值（字符串、数字、null、日期列的 'YYYY-MM-DD' 字符串）原样不动。
 */
export function convertTimestamps<T>(value: T): T {
  return convert(value) as T;
}

function convert(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(convert);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
  }
  return value;
}

// 只递归"普通对象"：Date、Timestamp、GeoPoint、DocumentReference 这类有原型的实例不拆开
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
