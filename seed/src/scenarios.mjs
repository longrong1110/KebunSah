// 场景表：先定每个地块"要是什么状态、毛病出在哪"，再去造数据，最后由规则引擎核对结果对不对。
// 总数 200 = 3 个演示地块 + 197 个生成：green 110 / yellow 50 / red 24 / needs_review 16（企划书 §8.10 的演示比例）。
// 演示地块各占一格：green 1（全通过）、yellow 1（面积多出 + 执照临期）、red 1（已故父亲 + 执照过期 + 面积 > 50% + 不在名单）。

export const TARGET_COUNTS = { green: 110, yellow: 50, red: 24, needs_review: 16 };

const mk = (target, kind, over = {}) => ({
  target,
  kind,
  area: 'pass', // pass | pass_floor | warn | fail
  licence: 'ok', // ok | expiring | expired | missing
  deceased: false, // 地契在已故父亲名下
  nameVariant: null, // null | title | licence | member：纸面拼写差异出现在哪一处
  coOwners: 0, // 额外的共有人数
  inMspo: true,
  lowConf: null, // null | { field: area | validUntil | name, confirmed }
  geometry: 'polygon', // polygon | point
  boundaryConf: false, // 某个关键字段置信度恰好 0.70（视为不低）
  ...over,
});

export function makeScenarios(rng) {
  const take = (arr, from, n) => arr.slice(from, from + n);

  // ---- green：生成 109 个 ----
  const green = Array.from({ length: 109 }, () => mk('green', 'green'));
  const gi = rng.shuffle(green.map((_, i) => i));
  take(gi, 0, 3).forEach((i) => { green[i].area = 'pass_floor'; green[i].kind = 'green_small_floor'; });
  take(gi, 3, 22).forEach((i) => { green[i].geometry = 'point'; green[i].kind = 'green_point'; });
  take(gi, 25, 10).forEach((i) => { green[i].nameVariant = rng.pick(['title', 'licence', 'member']); });
  take(gi, 35, 12).forEach((i) => { green[i].coOwners = rng.pick([1, 1, 2]); });
  const corrected = ['area', 'area', 'validUntil', 'validUntil', 'name', 'name'];
  take(gi, 47, 6).forEach((i, k) => { green[i].lowConf = { field: corrected[k], confirmed: true }; });
  take(gi, 53, 4).forEach((i) => { green[i].boundaryConf = true; });

  // ---- yellow：生成 49 个 ----
  const yellow = [
    ...Array.from({ length: 17 }, () => mk('yellow', 'yellow_area', { area: 'warn' })),
    ...Array.from({ length: 12 }, () => mk('yellow', 'yellow_expiring', { licence: 'expiring' })),
    ...Array.from({ length: 2 }, () => mk('yellow', 'yellow_area_expiring', { area: 'warn', licence: 'expiring' })),
    ...Array.from({ length: 5 }, () => mk('yellow', 'yellow_missing_licence', { licence: 'missing' })),
    ...Array.from({ length: 10 }, () => mk('yellow', 'yellow_not_in_mspo', { inMspo: false })),
    ...Array.from({ length: 3 }, () => mk('yellow', 'yellow_expiring_not_in_mspo', { licence: 'expiring', inMspo: false })),
  ];
  // 面积多出的黄块里，穿插几个拼写差异与共有人
  const yi = rng.shuffle(yellow.map((y, i) => (y.kind === 'yellow_area' ? i : -1)).filter((i) => i >= 0));
  take(yi, 0, 3).forEach((i) => { yellow[i].nameVariant = rng.pick(['title', 'licence', 'member']); });
  take(yi, 3, 2).forEach((i) => { yellow[i].coOwners = 1; });

  // ---- red：生成 23 个 ----
  const red = [
    ...Array.from({ length: 15 }, (_, k) => mk('red', 'red_deceased', { deceased: true, inMspo: k >= 5 })),
    ...Array.from({ length: 4 }, () => mk('red', 'red_expired', { licence: 'expired' })),
    ...Array.from({ length: 4 }, () => mk('red', 'red_area', { area: 'fail' })),
  ];

  // ---- needs_review：16 个，关键字段置信度 < 0.7 且没人确认，其余规则全通过 ----
  const nrFields = [...Array(6).fill('area'), ...Array(5).fill('validUntil'), ...Array(5).fill('name')];
  const needsReview = nrFields.map((field) => mk('needs_review', `needs_review_${field}`, { lowConf: { field, confirmed: false } }));

  return rng.shuffle([...green, ...yellow, ...red, ...needsReview]);
}
