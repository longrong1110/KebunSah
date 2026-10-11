import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach } from 'vitest';
import { I18nService } from '../core/i18n/i18n.service';
import { LangButton } from './lang-button';

describe('LangButton', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function setup() {
    const fixture = TestBed.createComponent(LangButton);
    fixture.detectChanges();
    const button = () => (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { fixture, button, i18n: TestBed.inject(I18nService) };
  }

  it('可见文字是当前语言的代码；无障碍名称以它开头并说明点了会怎样（label-in-name）', () => {
    const { button } = setup();
    expect(button().textContent).toContain('BM');
    expect(button().getAttribute('aria-label')).toBe('BM — Tukar bahasa ke English');
    expect(button().getAttribute('aria-label')?.startsWith('BM')).toBe(true);
  });

  it('点一下切到另一种语言，名称随之变化，仍以可见文字开头', () => {
    const { button, fixture, i18n } = setup();
    button().click();
    fixture.detectChanges();
    expect(i18n.lang()).toBe('en');
    expect(button().textContent).toContain('EN');
    expect(button().getAttribute('aria-label')).toBe('EN — Switch language to Bahasa Malaysia');
  });
});
