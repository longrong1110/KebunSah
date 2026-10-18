import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppUpdate } from './app-update';

@Component({ template: '' })
class Blank {}

function setup(enabled = true) {
  const versions = new Subject<{ type: string }>();
  const sw = {
    isEnabled: enabled,
    versionUpdates: versions,
    checkForUpdate: vi.fn(async () => false),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/new', component: Blank },
        { path: 'plots/new/map', component: Blank },
        { path: 'plots/:id', component: Blank },
      ]),
      { provide: SwUpdate, useValue: sw },
    ],
  });
  const reload = vi.fn();
  TestBed.inject(AppUpdate).start(reload);
  return { versions, sw, reload, router: TestBed.inject(Router) };
}

describe('AppUpdate（新版本自动换上）', () => {
  it('新版本下载好、不在新建地块的页面：马上重新加载', async () => {
    const s = setup();
    await RouterTestingHarness.create('/plots/p1');
    s.versions.next({ type: 'VERSION_READY' });
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('正在新建地块（草稿在内存里）：先不加载；离开那几页之后才加载，且只加载一次', async () => {
    const s = setup();
    const h = await RouterTestingHarness.create('/plots/new/map');
    s.versions.next({ type: 'VERSION_READY' });
    expect(s.reload).not.toHaveBeenCalled();
    await h.navigateByUrl('/plots/new');
    expect(s.reload).not.toHaveBeenCalled();
    await h.navigateByUrl('/plots/p1');
    expect(s.reload).toHaveBeenCalledTimes(1);
    await h.navigateByUrl('/');
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('别的版本事件（检测到、安装失败）不加载', async () => {
    const s = setup();
    await RouterTestingHarness.create('/');
    s.versions.next({ type: 'VERSION_DETECTED' });
    s.versions.next({ type: 'VERSION_INSTALLATION_FAILED' });
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('回到这个标签页时主动查一次有没有新版本；查失败不报错', async () => {
    const s = setup();
    s.sw.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.sw.checkForUpdate).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it('没有启用 Service Worker（开发环境、测试）：什么都不做', async () => {
    const s = setup(false);
    await RouterTestingHarness.create('/');
    s.versions.next({ type: 'VERSION_READY' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.sw.checkForUpdate).not.toHaveBeenCalled();
  });
});
