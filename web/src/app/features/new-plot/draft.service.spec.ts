import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DOC_TYPES, DraftService, isDocType } from './draft.service';

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
