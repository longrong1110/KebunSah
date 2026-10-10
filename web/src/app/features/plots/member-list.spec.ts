import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { MemberList } from './member-list';

@Component({
  imports: [MemberList],
  template: `<app-member-list [(query)]="query" (selected)="picked.push($event)" />`,
})
class Host {
  readonly query = signal('');
  readonly picked: string[] = [];
}

// 故意带上 icHash / icLast4：它们会随文档下载，但界面不能渲染
const person = (id: string, fullName: string) => ({
  id,
  data: { fullName, icHash: 'f'.repeat(64), icLast4: '5117' },
});

const PEOPLE = [
  person('p3', 'TAN AH KOW'),
  person('p1', 'AHMAD ZAKI BIN ROSLI'),
  person('p4', 'MUTHU A/L RAMAN'),
  person('p2', 'SITI AISHAH BINTI ABDULLAH'),
];

function setup() {
  localStorage.clear();
  const facade = new FakeFacade();
  TestBed.configureTestingModule({ providers: [{ provide: FIRESTORE_FACADE, useValue: facade }] });
  const fixture = TestBed.createComponent(Host);
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    facade,
    host: fixture.componentInstance,
    el,
    rows: () => [...el.querySelectorAll('.member-row')].map((b) => b.textContent?.trim()),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    type: (value: string) => {
      const input = el.querySelector<HTMLInputElement>('#member-search')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    },
  };
}

describe('MemberList', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('按姓名 A–Z 排，显示词首大写的姓名（bin / binti / a/l 小写）', async () => {
    const { fixture, facade, rows } = setup();
    await settle(fixture);
    facade.emitCollection('persons', PEOPLE);
    await settle(fixture);
    expect(rows()).toEqual([
      'Ahmad Zaki bin Rosli',
      'Muthu a/l Raman',
      'Siti Aishah binti Abdullah',
      'Tan Ah Kow',
    ]);
  });

  it('不渲染 icLast4 / icHash，也不会让它们参与搜索', async () => {
    const { fixture, facade, el, type, rows } = setup();
    await settle(fixture);
    facade.emitCollection('persons', PEOPLE);
    await settle(fixture);
    expect(el.innerHTML).not.toContain('5117');
    expect(el.innerHTML).not.toContain('ffffffff');
    type('5117');
    await settle(fixture);
    expect(rows()).toEqual([]); // 号码后四位不是搜索条件
  });

  it('搜索实时过滤：大小写不敏感，多词乱序，a/l 与 al 等价', async () => {
    const { fixture, facade, type, rows, host } = setup();
    await settle(fixture);
    facade.emitCollection('persons', PEOPLE);
    await settle(fixture);

    type('zaki rosli');
    await settle(fixture);
    expect(rows()).toEqual(['Ahmad Zaki bin Rosli']);
    expect(host.query()).toBe('zaki rosli'); // 双向绑定：搜索词在父页面里

    type('AL');
    await settle(fixture);
    expect(rows()).toContain('Muthu a/l Raman');

    type('binti');
    await settle(fixture);
    expect(rows()).toEqual(['Siti Aishah binti Abdullah']);
  });

  it('没有匹配：显示「Tiada ahli sepadan」和清除按钮，清空后恢复全部', async () => {
    const { fixture, facade, type, el, text, rows } = setup();
    await settle(fixture);
    facade.emitCollection('persons', PEOPLE);
    await settle(fixture);
    type('xyz');
    await settle(fixture);
    expect(rows()).toEqual([]);
    expect(text()).toContain('Tiada ahli sepadan');
    el.querySelector<HTMLButtonElement>('#member-clear')!.click();
    await settle(fixture);
    expect(rows().length).toBe(4);
    expect(el.querySelector('#member-clear')).toBeNull();
  });

  it('父页面持有的搜索词会带进来（选了成员再返回时还在）', async () => {
    const { fixture, facade, host, rows } = setup();
    host.query.set('tan');
    await settle(fixture);
    facade.emitCollection('persons', PEOPLE);
    await settle(fixture);
    expect(rows()).toEqual(['Tan Ah Kow']);
  });

  it('点一行：发出该成员的 id', async () => {
    const { fixture, facade, el, host } = setup();
    await settle(fixture);
    facade.emitCollection('persons', PEOPLE);
    await settle(fixture);
    [...el.querySelectorAll<HTMLButtonElement>('.member-row')]
      .find((b) => b.textContent?.includes('Muthu'))!
      .click();
    expect(host.picked).toEqual(['p4']);
  });

  it('没有姓名的文档被忽略，不渲染空行', async () => {
    const { fixture, facade, rows } = setup();
    await settle(fixture);
    facade.emitCollection('persons', [person('p1', 'ZAKI'), { id: 'x', data: {} }]);
    await settle(fixture);
    expect(rows()).toEqual(['Zaki']);
  });

  it('四态：服务器确认前显示加载（空缓存不当成没有成员）；10 秒转离线；确认为空显示空态；出错显示错误', async () => {
    vi.useFakeTimers();
    const a = setup();
    await settle(a.fixture);
    expect(a.text()).toContain('Memuatkan');
    a.facade.emitCollection('persons', [], { fromCache: true });
    await settle(a.fixture);
    expect(a.el.querySelector('#members-empty')).toBeNull();
    expect(a.el.querySelector('#members-loading')).not.toBeNull();
    vi.advanceTimersByTime(10_000);
    await settle(a.fixture);
    expect(a.el.querySelector('#members-error')?.textContent).toContain('Tiada sambungan');
    a.facade.emitCollection('persons', [], { fromCache: false });
    await settle(a.fixture);
    expect(a.el.querySelector('#members-empty')).not.toBeNull();
    TestBed.resetTestingModule();

    const b = setup();
    await settle(b.fixture);
    b.facade.failCollection('persons');
    await settle(b.fixture);
    expect(b.el.querySelector('#members-error')?.textContent).toContain('Tidak dapat memuat');
  });

  it('「Cuba lagi」：取消旧监听并重新订阅，不用刷新页面', async () => {
    vi.useFakeTimers();
    const { fixture, facade, el } = setup();
    await settle(fixture);
    vi.advanceTimersByTime(10_000);
    await settle(fixture);
    expect(facade.collections.length).toBe(1);
    el.querySelector<HTMLButtonElement>('#members-error + button')!.click();
    await settle(fixture);
    expect(facade.collections.length).toBe(2);
    expect(facade.activeCollections('persons').length).toBe(1);
  });

  it('销毁后取消监听', async () => {
    const { fixture, facade } = setup();
    await settle(fixture);
    expect(facade.activeCount).toBe(1);
    fixture.destroy();
    expect(facade.activeCount).toBe(0);
  });
});
