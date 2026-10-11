import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { onTestFinished, vi } from 'vitest';
import { BackNavigator } from '../app/core/back-navigator';

/**
 * 让 BackNavigator 认为「有历史」或「没有历史」，并把 Location.back 换成 spy 返回。
 * 要在页面创建之后、点返回之前调用。测试环境里 history.length 恒为 1（TestBed 用 MockPlatformLocation，不碰真实历史），
 * 所以不调用它时走的是「没有历史」的兜底导航。两个 spy 在这个用例结束时自动还原，不会影响同文件里的别的用例。
 */
export function stubHistory(hasHistory: boolean) {
  const can = vi.spyOn(BackNavigator.prototype, 'canGoBack').mockReturnValue(hasHistory);
  const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => undefined);
  onTestFinished(() => {
    can.mockRestore();
    back.mockRestore();
  });
  return back;
}
