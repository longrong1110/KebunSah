import { ChangeDetectionStrategy, Component } from '@angular/core';

// KebunSah 的标识：一块地的轮廓（kebun＝园）里打一个对勾（sah＝合法、有效）。颜色全部取自主题变量，深浅色都能用。
@Component({
  selector: 'app-brand-mark',
  template: `
    <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect class="tile" x="1" y="1" width="30" height="30" rx="8" />
      <polygon class="parcel" points="8.5,21.5 7.5,12 16.5,7.5 24.5,11.5 23.5,21 15.5,24.5" />
      <path class="tick" d="M12.4 16.2 15.1 18.9 20.3 12.9" />
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandMark {}
