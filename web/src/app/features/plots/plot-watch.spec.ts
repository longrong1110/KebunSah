import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import type { Load } from '../../core/load-state';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { pageState, watchPlot } from './plot-watch';

const loading: Load<unknown> = { kind: 'loading' };
const offline: Load<unknown> = { kind: 'offline' };
const error: Load<unknown> = { kind: 'error' };
const data = (v: unknown = {}): Load<unknown> => ({ kind: 'data', value: v, fromCache: false });
// 地块文档：data 里有内容 = 服务器确认存在；data 为 null = 服务器确认不存在
const plotExists = {
  kind: 'data',
  value: { id: 'p1', data: {}, fromCache: false },
  fromCache: false,
} as const;
const plotMissing = {
  kind: 'data',
  value: { id: 'p1', data: null, fromCache: false },
  fromCache: false,
} as const;

describe('pageState（屏 7／9／10、档案页共用的页面状态）', () => {
  it('地块和其余订阅都读到：ready；没有其余订阅时只看地块', () => {
    expect(pageState(plotExists, [data(), data()])).toBe('ready');
    expect(pageState(plotExists)).toBe('ready');
  });

  it('任何一个还没读到（null 或 loading）：loading，包括地块还没读到', () => {
    expect(pageState(null, [data()])).toBe('loading');
    expect(pageState(plotExists, [null])).toBe('loading');
    expect(pageState(plotExists, [data(), loading])).toBe('loading');
    expect(pageState(loading, [data()])).toBe('loading');
  });

  it('任何一个离线：offline（优先于 loading）', () => {
    expect(pageState(plotExists, [offline])).toBe('offline');
    expect(pageState(offline, [data()])).toBe('offline');
    expect(pageState(plotExists, [loading, offline])).toBe('offline');
  });

  it('任何一个出错：error（优先于一切，包括离线与地块不存在）', () => {
    expect(pageState(plotExists, [error])).toBe('error');
    expect(pageState(error, [data()])).toBe('error');
    expect(pageState(plotMissing, [error])).toBe('error');
    expect(pageState(plotExists, [offline, error])).toBe('error');
  });

  it('地块服务器确认不存在：notfound，不管其余读到没有（优先于离线与加载中）', () => {
    expect(pageState(plotMissing, [])).toBe('notfound');
    expect(pageState(plotMissing, [null])).toBe('notfound');
    expect(pageState(plotMissing, [loading, offline])).toBe('notfound');
  });

  it('其余订阅里「没有数据」不等于地块不存在：只有地块文档本身决定 notfound', () => {
    expect(pageState(plotExists, [data(null)])).toBe('ready');
  });
});

describe('watchPlot（共用订阅）', () => {
  @Component({ template: '' })
  class Host {
    readonly id = signal<string | null>(null);
    readonly w = watchPlot(this.id);
    readonly assessments = this.w.subcollection<{ runStatus?: string }>('assessments');
    readonly documents = this.w.subcollection<{ docType?: string }>('documents');
  }

  function setup() {
    const facade = new FakeFacade();
    TestBed.configureTestingModule({
      providers: [{ provide: FIRESTORE_FACADE, useValue: facade }],
    });
    const fixture = TestBed.createComponent(Host);
    return { facade, fixture, host: fixture.componentInstance };
  }

  it('id 为空：不订阅，plot 与子集合都是 null', async () => {
    const { facade, fixture, host } = setup();
    await settle(fixture);
    expect(facade.activeCount).toBe(0);
    expect(host.w.plot()).toBeNull();
    expect(host.assessments()).toBeNull();
  });

  it('有 id：订阅 plots/{id} 与 plots/{id}/assessments，读到服务器确认的数据', async () => {
    const { facade, fixture, host } = setup();
    host.id.set('p1');
    await settle(fixture);
    expect(facade.activeDocs('plots/p1')).toHaveLength(1);
    expect(facade.activeCollections('plots/p1/assessments')).toHaveLength(1);
    facade.emitDoc('plots/p1', { status: 'green' });
    facade.emitCollection('plots/p1/assessments', [{ id: 'a1', data: { runStatus: 'done' } }]);
    await settle(fixture);
    const plot = host.w.plot();
    expect(plot?.kind === 'data' && plot.value.data).toMatchObject({ status: 'green' });
    const list = host.assessments();
    expect(list?.kind === 'data' && list.value.docs.map((d) => d.id)).toEqual(['a1']);
  });

  it('换 id：旧订阅取消，新 id 的数据取代旧的', async () => {
    const { facade, fixture, host } = setup();
    host.id.set('p1');
    await settle(fixture);
    facade.emitDoc('plots/p1', { status: 'green' });
    host.id.set('p2');
    await settle(fixture);
    expect(facade.activeDocs('plots/p1')).toHaveLength(0);
    expect(facade.activeCollections('plots/p1/assessments')).toHaveLength(0);
    expect(facade.activeDocs('plots/p2')).toHaveLength(1);
    facade.emitDoc('plots/p2', { status: 'red' });
    await settle(fixture);
    const plot = host.w.plot();
    expect(plot?.kind === 'data' && plot.value.data).toMatchObject({ status: 'red' });
  });

  it('retry()：用同一个 watcher 建出来的订阅全部重新订阅（旧的取消、新的建立）', async () => {
    const { facade, fixture, host } = setup();
    host.id.set('p1');
    await settle(fixture);
    const docsBefore = facade.docs.length;
    const collectionsBefore = facade.collections.length;
    host.w.retry();
    await settle(fixture);
    expect(facade.docs.length).toBe(docsBefore + 1);
    expect(facade.collections.length).toBe(collectionsBefore + 2); // assessments 与 documents 各重新订阅一次
    expect(facade.activeDocs('plots/p1')).toHaveLength(1);
    expect(facade.activeCollections('plots/p1/assessments')).toHaveLength(1);
    expect(facade.activeCollections('plots/p1/documents')).toHaveLength(1);
  });

  it('组件销毁：取消全部订阅，没有残留的监听', async () => {
    const { facade, fixture, host } = setup();
    host.id.set('p1');
    await settle(fixture);
    expect(facade.activeCount).toBeGreaterThan(0);
    fixture.destroy();
    expect(facade.activeCount).toBe(0);
  });
});
