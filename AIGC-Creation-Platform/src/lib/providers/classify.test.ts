import { describe, expect, it } from 'vitest';
import { guessKind, kindFromProviderType, resolveKind } from './classify';

// 分类优先级容易写反（audio 含 chat 字样、provider type 与名字冲突），这里钉死。
describe('guessKind —— 按模型名猜用途', () => {
  const cases: [string, string][] = [
    ['gpt-image-2', 'image'],
    ['dall-e-3', 'image'],
    ['flux-dev', 'image'],
    ['sora-2', 'video'],
    ['kling-v1', 'video'],
    ['veo-3', 'video'],
    ['text-embedding-3-large', 'other'],
    // 'gpt-4o-audio-preview' 含 audio，必须先归 other 而不是被当成 chat
    ['gpt-4o-audio-preview', 'other'],
    ['whisper-1', 'other'],
    ['gpt-4o', 'chat'],
    ['claude-3-5-sonnet', 'chat'],
  ];
  for (const [id, kind] of cases) {
    it(`${id} → ${kind}`, () => {
      expect(guessKind(id)).toBe(kind);
    });
  }
});

describe('kindFromProviderType —— 供应商 type 宽松映射', () => {
  it('认得的 type 直接用（大小写不敏感）', () => {
    expect(kindFromProviderType('image')).toBe('image');
    expect(kindFromProviderType('LLM')).toBe('chat');
    expect(kindFromProviderType('video-generation')).toBe('video');
  });

  it('认不得或为空 → null，退回名字规则', () => {
    expect(kindFromProviderType('weird-type')).toBeNull();
    expect(kindFromProviderType(null)).toBeNull();
    expect(kindFromProviderType('')).toBeNull();
  });
});

describe('resolveKind —— provider 优先于 guess', () => {
  it('供应商给了 type 就用它，哪怕名字像别的类', () => {
    expect(resolveKind('gpt-4o', 'image')).toEqual({ kind: 'image', source: 'provider' });
  });

  it('没有 type 才靠名字猜', () => {
    expect(resolveKind('gpt-image-2', null)).toEqual({ kind: 'image', source: 'guess' });
  });
});