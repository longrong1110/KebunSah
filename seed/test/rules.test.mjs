import test from 'node:test';
import assert from 'node:assert/strict';
import { cc01, cc02, cc03, aggregate, deriveGaps, isUnconfirmedLow } from '../src/rules.mjs';
import { similarity } from '../src/similarity.mjs';

const ASOF = '2026-10-09';

test('CC-01：容差取地契面积 10% 与 0.1 公顷中较大者', () => {
  // 大地块用 10%：3.04 公顷容差 0.304
  assert.equal(cc01({ titleHa: 3.04, plotHa: 3.34 }).result, 'pass'); // 多 0.30 < 0.304
  assert.equal(cc01({ titleHa: 3.04, plotHa: 3.35 }).result, 'warn'); // 多 0.31 > 0.304
  // 小地块用 0.1 公顷下限：0.6 公顷的 10% 只有 0.06，但容差是 0.1
  assert.equal(cc01({ titleHa: 0.6, plotHa: 0.69 }).result, 'pass'); // 多 15% 仍在 0.1 公顷内
  assert.equal(cc01({ titleHa: 0.6, plotHa: 0.71 }).result, 'warn');
  // 恰好等于容差算通过（over > tol 才警告）
  assert.equal(cc01({ titleHa: 1, plotHa: 1.1 }).result, 'pass');
});

test('CC-01：多出超过 50% 才是红，恰好 50% 仍是黄', () => {
  assert.equal(cc01({ titleHa: 2, plotHa: 3 }).result, 'warn');
  assert.equal(cc01({ titleHa: 2, plotHa: 3.0001 }).result, 'fail');
  assert.equal(cc01({ titleHa: 2, plotHa: 3.4 }).result, 'fail'); // 演示红块：多 70%
});

test('CC-01：面积比地契小不判，一律通过', () => {
  assert.equal(cc01({ titleHa: 5, plotHa: 3 }).result, 'pass');
});

test('CC-01：演示三块', () => {
  assert.equal(cc01({ titleHa: 4.2, plotHa: 4.23 }).result, 'pass');
  assert.equal(cc01({ titleHa: 3.04, plotHa: 3.49 }).result, 'warn');
});

test('CC-02：不足 90 天警告、已过期失败、到期当天不算过期', () => {
  const r = (validUntil) => cc02({ asOf: ASOF, licenceValidUntil: validUntil });
  assert.equal(r('2027-01-07').result, 'pass'); // 恰好 90 天
  assert.equal(r('2027-01-06').result, 'warn'); // 89 天
  assert.equal(r('2026-10-09').result, 'warn'); // 到期当天：0 天，未过期，但 < 90
  assert.equal(r('2026-10-08').result, 'fail'); // 过期 1 天
  assert.equal(r('2027-03-31').meta.days, 173);
  assert.equal(r('2026-12-05').meta.days, 57);
  assert.equal(r('2026-04-30').meta.kind, 'expired');
});

test('CC-02：租约与证书到期取最早的一个；缺执照记黄', () => {
  assert.equal(cc02({ asOf: ASOF, licenceValidUntil: '2028-01-01', leaseExpiry: '2026-11-01' }).result, 'warn');
  assert.equal(cc02({ asOf: ASOF, licenceValidUntil: '2028-01-01', certExpiry: '2026-10-01' }).result, 'fail');
  const missing = cc02({ asOf: ASOF, licenceValidUntil: null });
  assert.equal(missing.result, 'warn');
  assert.equal(missing.meta.kind, 'missing');
});

test('CC-03：相似度 ≥ 0.85 通过；地契取各持有人里最像的；三处取最低', () => {
  assert.equal(cc03({ operatorName: 'TAN AH KOW', titleNames: ['TAN AH KOW'] }).result, 'pass');
  // 共有人：只要有一位像就行
  assert.equal(cc03({ operatorName: 'TAN AH KOW', titleNames: ['LIM SOON HOCK', 'TAN AH KOW'] }).result, 'pass');
  // 三处里任何一处差太多就失败
  assert.equal(cc03({ operatorName: 'TAN AH KOW', titleNames: ['TAN AH KOW'], licenceName: 'LEE MEI LING' }).result, 'fail');
  assert.equal(cc03({ operatorName: 'MUTHU A/L RAMAN', titleNames: ['RAMAN A/L SUBRAMANIAM'], licenceName: 'MUTHU A/L RAMAN' }).result, 'fail'); // 演示红块
  assert.ok(similarity('AHMAD ZAKI BIN ROSLI', 'AHMAD ZAKI B. ROSLI') >= 0.9);
  assert.equal(similarity('A', 'A'), 1);
});

test('置信度：低于 0.70 且未确认才算读不准，恰好 0.70 不算', () => {
  assert.equal(isUnconfirmedLow({ confidence: 0.69 }), true);
  assert.equal(isUnconfirmedLow({ confidence: 0.7 }), false);
  assert.equal(isUnconfirmedLow({ confidence: 0.64, confirmedValue: '2026-12-05' }), false); // 演示黄块：已确认
  assert.equal(isUnconfirmedLow(null), false);
});

test('聚合：fail > needs_review > warn > pass，任何 open 缺口至少 yellow', () => {
  const r = (...xs) => xs.map((result) => ({ result }));
  assert.equal(aggregate(r('pass', 'pass', 'pass'), []), 'green');
  assert.equal(aggregate(r('pass', 'warn', 'pass'), []), 'yellow');
  assert.equal(aggregate(r('pass', 'pass', 'pass'), [{ status: 'open' }]), 'yellow'); // 只有 not_in_mspo
  assert.equal(aggregate(r('warn', 'needs_review', 'pass'), []), 'needs_review');
  assert.equal(aggregate(r('warn', 'needs_review', 'fail'), []), 'red');
  assert.equal(aggregate(r('pass', 'pass', 'pass'), [{ status: 'resolved' }]), 'green');
});

test('缺口：每条非通过规则对应一条，不在名单另算', () => {
  const results = [
    cc01({ titleHa: 3.04, plotHa: 3.49 }),
    cc02({ asOf: ASOF, licenceValidUntil: '2026-12-05' }),
    cc03({ operatorName: 'TAN AH KOW', titleNames: ['TAN AH KOW'] }),
  ];
  const gaps = deriveGaps(results, { notInMspo: true });
  assert.deepEqual(gaps.map((g) => g.gapCode), ['area_mismatch', 'expiring', 'not_in_mspo']);
  assert.ok(gaps.every((g) => g.status === 'open' && ['high', 'medium', 'low'].includes(g.severity)));
  assert.equal(deriveGaps([cc01({ titleHa: 1, plotHa: 1 })], { notInMspo: false }).length, 0);
});
