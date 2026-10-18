import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { AuthService } from '../../core/firebase/auth.service';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { CurrentRole } from './current-role';

function setup(uid: string | null) {
  const facade = new FakeFacade();
  const user = signal<{ uid: string } | null>(uid ? { uid } : null);
  TestBed.configureTestingModule({
    providers: [
      { provide: FIRESTORE_FACADE, useValue: facade },
      { provide: AuthService, useValue: { user } },
    ],
  });
  return { facade, user, role: TestBed.inject(CurrentRole) };
}

const flush = () => new Promise((r) => setTimeout(r));

describe('CurrentRole', () => {
  it('没登录：没有角色，不是只读', () => {
    const { role } = setup(null);
    expect(role.role()).toBeNull();
    expect(role.readOnly()).toBe(false);
  });

  it('合作社管理员只读；园主、外勤不是', async () => {
    for (const [r, readOnly] of [
      ['coop_admin', true],
      ['smallholder', false],
      ['field_officer', false],
    ] as const) {
      TestBed.resetTestingModule();
      const { facade, role } = setup('u1');
      TestBed.flushEffects?.();
      role.role(); // 触发订阅
      await flush();
      facade.emitDoc('users/u1', { role: r });
      await flush();
      expect(role.role(), r).toBe(r);
      expect(role.readOnly(), r).toBe(readOnly);
    }
  });

  it('档案还没读到或不存在：不当成只读（后端仍然会拦）', async () => {
    const { facade, role } = setup('u1');
    role.role();
    await flush();
    expect(role.readOnly()).toBe(false);
    facade.emitDoc('users/u1', null);
    await flush();
    expect(role.role()).toBeNull();
    expect(role.readOnly()).toBe(false);
  });
});

void settle;
