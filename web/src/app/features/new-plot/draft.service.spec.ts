import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DOC_TYPES, DraftService, isDocType } from './draft.service';
import type { LngLat } from './geometry';

let counter = 0;

function setup() {
  // jsdom 没有 createObjectURL：用假的，并记录哪些 URL 被撤销
  const created: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const u = `blob:test/${++counter}`;
      created.push(u);
      return u;
    },
    revokeObjectURL: (u: string) => revoked.push(u),
  });
  TestBed.resetTestingModule();
  return { draft: TestBed.inject(DraftService), created, revoked };
}

const blob = () => new Blob(['x'], { type: 'image/jpeg' });

describe('DraftService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('初始：三份文档按固定顺序都是待拍，不能进下一步，第一张待拍是地契', () => {
    const { draft } = setup();
    expect(draft.entries().map((e) => e.type)).toEqual(['land_title', 'mspo_cert', 'mpob_licence']);
    expect(draft.entries().every((e) => e.doc.status === 'pending')).toBe(true);
    expect(draft.allResolved()).toBe(false);
    expect(draft.firstPending()).toBe('land_title');
  });

  it('拍了一张：变已拍，带预览 URL 与来源；第一张待拍顺延', () => {
    const { draft, created } = setup();
    draft.capture('land_title', blob(), 'camera');
    const d = draft.doc('land_title');
    expect(d.status).toBe('captured');
    if (d.status === 'captured') {
      expect(d.url).toBe(created[0]);
      expect(d.source).toBe('camera');
    }
    expect(draft.firstPending()).toBe('mspo_cert');
  });

  it('三张都可以跳过：跳过后不再是待拍，全部处理完才可以进下一步', () => {
    const { draft } = setup();
    draft.skip('land_title');
    draft.skip('mspo_cert');
    expect(draft.allResolved()).toBe(false);
    draft.skip('mpob_licence');
    expect(draft.allResolved()).toBe(true);
    expect(draft.firstPending()).toBeNull();
  });

  it('已拍与已跳过混合也算处理完', () => {
    const { draft } = setup();
    draft.capture('land_title', blob(), 'gallery');
    draft.skip('mspo_cert');
    draft.capture('mpob_licence', blob(), 'camera');
    expect(draft.allResolved()).toBe(true);
  });

  it('已跳过的还可以再拍；已拍的可以再跳过；都不会卡死', () => {
    const { draft } = setup();
    draft.skip('mspo_cert');
    draft.capture('mspo_cert', blob(), 'camera');
    expect(draft.doc('mspo_cert').status).toBe('captured');
    draft.skip('mspo_cert');
    expect(draft.doc('mspo_cert').status).toBe('skipped');
  });

  it('重拍：替换并撤销旧的预览 URL，新的 URL 不同', () => {
    const { draft, created, revoked } = setup();
    draft.capture('land_title', blob(), 'camera');
    draft.capture('land_title', blob(), 'gallery');
    expect(created.length).toBe(2);
    expect(revoked).toEqual([created[0]]);
    const d = draft.doc('land_title');
    expect(d.status === 'captured' && d.url).toBe(created[1]);
  });

  it('已拍的被跳过：撤销预览 URL', () => {
    const { draft, created, revoked } = setup();
    draft.capture('land_title', blob(), 'camera');
    draft.skip('land_title');
    expect(revoked).toEqual([created[0]]);
  });

  it('begin：得到全新的草稿并记下成员；旧照片的预览 URL 全部撤销', () => {
    const { draft, created, revoked } = setup();
    draft.capture('land_title', blob(), 'camera');
    draft.capture('mpob_licence', blob(), 'camera');
    draft.skip('mspo_cert');
    draft.begin('person-1');
    expect(revoked.sort()).toEqual([...created].sort());
    expect(draft.entries().every((e) => e.doc.status === 'pending')).toBe(true);
    expect(draft.memberId()).toBe('person-1');
  });

  it('reset：清空并撤销预览 URL，成员归零', () => {
    const { draft, created, revoked } = setup();
    draft.begin('person-1');
    draft.capture('land_title', blob(), 'camera');
    draft.reset();
    expect(revoked).toEqual([created[0]]);
    expect(draft.memberId()).toBeNull();
    expect(draft.allResolved()).toBe(false);
  });

  it('文档类型取自合同的 doc_type 字符串；非法值被识别', () => {
    expect([...DOC_TYPES]).toEqual(['land_title', 'mspo_cert', 'mpob_licence']);
    expect(isDocType('land_title')).toBe(true);
    expect(isDocType('mspo_member_list')).toBe(false); // 合同里有，但屏 3 不拍
    expect(isDocType('passport')).toBe(false);
    expect(isDocType(undefined)).toBe(false);
  });
});

describe('DraftService 几何（屏 5）', () => {
  afterEach(() => vi.unstubAllGlobals());

  const SQUARE: LngLat[] = [
    [101.16106, 4.326776],
    [101.162991, 4.326776],
    [101.162991, 4.325064],
    [101.16106, 4.325064],
  ];

  it('初始：A 页签、没有点，不能完成，没有结果', () => {
    const { draft } = setup();
    expect(draft.geometryDraft().tab).toBe('map');
    expect(draft.geometry()).toBeNull();
    expect(draft.evaluation().problem).toBe('few');
    expect(draft.canUndo()).toBe(false);
  });

  it('A 页签加点：满 3 个出多边形结果与面积', () => {
    const { draft } = setup();
    for (const p of SQUARE.slice(0, 2)) draft.addVertex('map', p);
    expect(draft.geometry()).toBeNull();
    draft.addVertex('map', SQUARE[2]);
    draft.addVertex('map', SQUARE[3]);
    const g = draft.geometry();
    expect(g?.kind).toBe('polygon');
    expect(g && g.kind === 'polygon' && g.areaHa).toBeCloseTo(4.0756, 2);
  });

  it('移动一个顶点：面积随之变；下标越界、非整数被忽略', () => {
    const { draft } = setup();
    for (const p of SQUARE) draft.addVertex('map', p);
    const before = draft.evaluation().areaHa;
    draft.moveVertex(1, [101.163592, 4.327204]);
    expect(draft.evaluation().areaHa).not.toBe(before);
    const snapshot = draft.geometryDraft().mapRing;
    draft.moveVertex(9, [0, 0]);
    draft.moveVertex(-1, [0, 0]);
    draft.moveVertex(1.5, [0, 0]);
    expect(draft.geometryDraft().mapRing).toBe(snapshot);
  });

  it('removeLast 撤销当前页签最后一个点：A、B 删最后一个顶点，C 清掉那个点（手填面积保留）', () => {
    const { draft } = setup();
    for (const p of SQUARE) draft.addVertex('map', p);
    draft.removeLast();
    expect(draft.geometryDraft().mapRing).toEqual(SQUARE.slice(0, 3));
    draft.setTab('walk');
    draft.addVertex('walk', SQUARE[0]);
    draft.addVertex('walk', SQUARE[1]);
    draft.removeLast();
    expect(draft.geometryDraft().walkRing).toEqual([SQUARE[0]]);
    draft.setTab('point');
    draft.setPoint([101.1, 4.3]);
    draft.setDeclared('2.5');
    expect(draft.canUndo()).toBe(true);
    draft.removeLast();
    expect(draft.geometryDraft().point).toBeNull();
    expect(draft.geometryDraft().declared).toBe('2.5');
    expect(draft.canUndo()).toBe(false);
    // 没有点时再撤销不报错
    draft.removeLast();
    expect(draft.geometryDraft().point).toBeNull();
  });

  it('切页签不丢各自的输入，结果只看当前页签', () => {
    const { draft } = setup();
    for (const p of SQUARE) draft.addVertex('map', p);
    draft.setTab('point');
    draft.setPoint([101.1, 4.3]);
    draft.setDeclared('1.2');
    expect(draft.geometry()).toEqual({ kind: 'point', point: [101.1, 4.3], declaredHa: 1.2 });
    draft.setTab('walk');
    expect(draft.geometry()).toBeNull();
    draft.setTab('map');
    expect(draft.geometry()?.kind).toBe('polygon');
    expect(draft.geometryDraft().point).toEqual([101.1, 4.3]);
    expect(draft.geometryDraft().declared).toBe('1.2');
  });

  it('begin 与 reset 清空几何草稿，页签回到 A', () => {
    const { draft } = setup();
    for (const p of SQUARE) draft.addVertex('map', p);
    draft.setTab('point');
    draft.setPoint([101.1, 4.3]);
    draft.setDeclared('1');
    draft.reset();
    expect(draft.geometryDraft()).toEqual({
      tab: 'map',
      mapRing: [],
      walkRing: [],
      point: null,
      declared: '',
    });
    draft.addVertex('map', SQUARE[0]);
    draft.begin(null);
    expect(draft.geometryDraft().mapRing).toEqual([]);
  });
});
