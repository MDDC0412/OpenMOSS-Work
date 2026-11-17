import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 手工加的模型必须扛住下一次体检 —— 这是"供应商没有模型列表接口"能用的前提。
// 真开一个临时库跑，不用 mock：要验证的正是 SQL 里的 kind_source <> 'manual' 条件。
let root: string;
let repo: typeof import('./repo');

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-models-test-'));
  // 必须在 import 之前设好：ANCHOR_DIR 在模块加载时就定死
  process.env.AIGC_ANCHOR_DIR = root;
  repo = await import('./repo');
});

afterAll(async () => {
  delete process.env.AIGC_ANCHOR_DIR;
  // Windows 上 -wal / -shm 句柄不释放就删不掉目录，必须先关连接
  const { closeDb } = await import('../db');
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('手工模型与体检刷新的共存规则', () => {
  it('没有列表接口时手填的模型，体检后仍在且用途不变', () => {
    const p = repo.insertProvider({
      name: '无列表接口的供应商',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
      models_endpoint: '',
    });
    repo.addModelManually(p.id, 'my-model-x', 'image');

    // 体检拿不到任何模型（接口没返回 / 根本没配），等价于 incoming=[]
    repo.refreshModels(p.id, []);

    const rows = repo.listModels(p.id);
    expect(rows.map((r) => r.model_id)).toEqual(['my-model-x']);
    expect(rows[0].kind).toBe('image');
    expect(rows[0].kind_source).toBe('manual');
  });

  it('接口返回过的模型，下一次不见了会被清掉（手工行不受此限）', () => {
    const p = repo.insertProvider({
      name: '正常供应商',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
      models_endpoint: '/v1/models',
    });
    repo.refreshModels(p.id, [{ model_id: 'gpt-4o', display_name: null, owned_by: null, raw_type: null }]);
    repo.addModelManually(p.id, 'hand-added', 'chat');

    // 第二轮接口只返回了一个新模型，gpt-4o 消失了；hand-added 是手工行，必须留着
    repo.refreshModels(p.id, [{ model_id: 'gpt-5', display_name: null, owned_by: null, raw_type: null }]);

    const ids = repo.listModels(p.id).map((r) => r.model_id);
    expect(ids).toContain('gpt-5');
    expect(ids).toContain('hand-added');
    expect(ids).not.toContain('gpt-4o');
  });

  it('重复手填同一个 ID 不报错，只是覆盖用途', () => {
    const p = repo.insertProvider({
      name: '重复手填',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
      models_endpoint: '',
    });
    repo.addModelManually(p.id, 'dup', 'chat');
    repo.addModelManually(p.id, 'dup', 'video');
    const rows = repo.listModels(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('video');
  });

  it('手工加的模型可以单独移除', () => {
    const p = repo.insertProvider({
      name: '移除测试',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
      models_endpoint: '',
    });
    repo.addModelManually(p.id, 'to-drop', 'chat');
    repo.removeModel(p.id, 'to-drop');
    expect(repo.listModels(p.id)).toHaveLength(0);
  });
});
