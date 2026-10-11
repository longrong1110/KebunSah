import type { AppEnvironment } from '../../../environments/environment.model';
import { firebaseConfigured } from './firebase';

const env = (apiKey: string, projectId: string): AppEnvironment => ({
  production: true,
  firebase: { apiKey, authDomain: '', projectId, appId: '' },
  emulators: null,
  mapsApiKey: '',
});

describe('firebaseConfigured', () => {
  it('生产配置留空 → 未配置（页面显示"服务尚未配置"，不白屏）', () => {
    expect(firebaseConfigured(env('', ''))).toBe(false);
  });

  it('只填了一半也算未配置', () => {
    expect(firebaseConfigured(env('key', ''))).toBe(false);
    expect(firebaseConfigured(env('', 'proj'))).toBe(false);
  });

  it('apiKey 与 projectId 都有 → 已配置', () => {
    expect(firebaseConfigured(env('key', 'proj'))).toBe(true);
  });
});
