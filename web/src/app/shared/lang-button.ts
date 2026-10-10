import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';

// 右上角常驻的语言按钮（线框里的「🌐 BM」）：显示当前语言，点一下切到另一种。
@Component({
  selector: 'app-lang-button',
  template: `
    <button
      type="button"
      class="lang-btn"
      [attr.aria-label]="i18n.t().lang.switchLabel"
      (click)="i18n.toggle()"
    >
      <span aria-hidden="true">🌐</span> {{ i18n.t().lang.code }}
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LangButton {
  protected readonly i18n = inject(I18nService);
}
