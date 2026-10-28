import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, toPublic, findSession } from '../src/server/config.js';

const tmpDir = path.join(os.tmpdir(), `drivenvibe-test-${Date.now()}`);
const tmpPath = path.join(tmpDir, 'config.json');

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

const legacySessions = [{ id: 'x', label: 'X', color: '#ffffff', project_dir: '/tmp' }];

const newFormatConfig = {
  projects: [{
    id: 'p1',
    label: 'My Project',
    color: '#3b82f6',
    sessions: [{ id: 'x', label: 'X', color: '#ffffff', project_dir: '/tmp' }],
  }],
};

describe('config', () => {
  it('migrates legacy sessions[] to projects[]', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({ sessions: legacySessions }));
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0].id).toBe('default');
    expect(cfg.projects[0].sessions[0].id).toBe('x');
  });

  it('loads new projects[] schema directly', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects[0].id).toBe('p1');
    expect(cfg.projects[0].sessions[0].id).toBe('x');
  });

  it('rejects missing projects field (no migration possible)', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({}));
    await expect(loadConfig(tmpPath)).rejects.toThrow();
  });

  it('strips project_dir from public config', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [{ id: 'x', label: 'X', color: '#ffffff', project_dir: '/secret', lang: 'sl-SI' }],
      }],
    }));
    const cfg = await loadConfig(tmpPath);
    const pub = toPublic(cfg);
    expect(pub.projects[0].sessions[0]).toEqual({
      id: 'x', label: 'X', color: '#ffffff', emoji: undefined, lang: 'sl-SI',
      tts_rate: 1.2, voice_mode: true, provider: 'subscription', model: undefined,
      stt_backend: 'browser',
    });
    expect(JSON.stringify(pub)).not.toContain('/secret');
  });

  it('defaults provider to subscription when missing', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects[0].sessions[0].provider).toBe('subscription');
  });

  it('accepts openrouter provider with a model', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [{
          id: 'or', label: 'OR', color: '#ffffff', project_dir: '/tmp',
          provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet',
        }],
      }],
    }));
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects[0].sessions[0].provider).toBe('openrouter');
    expect(cfg.projects[0].sessions[0].model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('accepts codex provider without an API key or model', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [{ id: 'codex', label: 'Codex', color: '#ffffff', project_dir: '/tmp', provider: 'codex' }],
      }],
    }));
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects[0].sessions[0].provider).toBe('codex');
    expect(cfg.projects[0].sessions[0].model).toBeUndefined();
  });

  it('rejects openrouter without a model', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [{ id: 'or', label: 'OR', color: '#ffffff', project_dir: '/tmp', provider: 'openrouter' }],
      }],
    }));
    await expect(loadConfig(tmpPath)).rejects.toThrow();
  });

  it('exposes provider and model in toPublic', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [{
          id: 'a', label: 'A', color: '#ffffff', project_dir: '/secret',
          provider: 'anthropic-api', model: 'claude-sonnet-4-5-20250929',
        }],
      }],
    }));
    const cfg = await loadConfig(tmpPath);
    const pub = toPublic(cfg);
    expect(pub.projects[0].sessions[0].provider).toBe('anthropic-api');
    expect(pub.projects[0].sessions[0].model).toBe('claude-sonnet-4-5-20250929');
    expect(JSON.stringify(pub)).not.toContain('/secret');
  });

  it('updateSession persists a per-session patch atomically', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [
          { id: 'a', label: 'A', color: '#ffffff', project_dir: '/tmp/a', tts_rate: 0.8, lang: 'en-US' },
          { id: 'b', label: 'B', color: '#ffffff', project_dir: '/tmp/b' },
        ],
      }],
    }));
    const { updateSession } = await import('../src/server/config.js');
    await updateSession(tmpPath, 'b', { tts_rate: 1.5, lang: 'sl-SI' });
    const cfg = await loadConfig(tmpPath);
    const allSessions = cfg.projects.flatMap((p) => p.sessions);
    const b = allSessions.find((s) => s.id === 'b')!;
    expect(b.tts_rate).toBe(1.5);
    expect(b.lang).toBe('sl-SI');
    const a = allSessions.find((s) => s.id === 'a')!;
    expect(a.tts_rate).toBe(0.8);
    expect(a.lang).toBe('en-US');
  });

  it('updateSession rejects unknown session id', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const { updateSession } = await import('../src/server/config.js');
    await expect(updateSession(tmpPath, 'nope', { tts_rate: 1.5 })).rejects.toThrow(/Unknown session/);
  });

  it('updateSession rejects creation-only fields in patch', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const { updateSession } = await import('../src/server/config.js');
    await expect(updateSession(tmpPath, 'x', { project_dir: '/etc/passwd' } as any))
      .rejects.toThrow(/not allowed/i);
  });

  it('addSession appends to correct project and returns new session with UUID', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const { addSession } = await import('../src/server/config.js');
    const created = await addSession(tmpPath, 'p1', {
      label: 'New', color: '#ff0000', project_dir: '/tmp/new',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.label).toBe('New');
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects[0].sessions).toHaveLength(2);
    expect(cfg.projects[0].sessions[1].id).toBe(created.id);
  });

  it('addProject creates project with empty sessions', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const { addProject } = await import('../src/server/config.js');
    const created = await addProject(tmpPath, { label: 'Second', color: '#10b981' });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.sessions).toHaveLength(0);
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects).toHaveLength(2);
    expect(cfg.projects[1].label).toBe('Second');
  });

  it('archiveSession sets archived flag', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const { archiveSession } = await import('../src/server/config.js');
    await archiveSession(tmpPath, 'x');
    const cfg = await loadConfig(tmpPath);
    expect(cfg.projects[0].sessions[0].archived).toBe(true);
  });

  it('toPublic filters archived sessions', async () => {
    await fs.writeFile(tmpPath, JSON.stringify({
      projects: [{
        id: 'p1', label: 'P', color: '#3b82f6',
        sessions: [
          { id: 'a', label: 'A', color: '#ffffff', project_dir: '/tmp/a' },
          { id: 'b', label: 'B', color: '#ffffff', project_dir: '/tmp/b', archived: true },
        ],
      }],
    }));
    const cfg = await loadConfig(tmpPath);
    const pub = toPublic(cfg);
    expect(pub.projects[0].sessions).toHaveLength(1);
    expect(pub.projects[0].sessions[0].id).toBe('a');
  });

  it('findSession returns project+session pair', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const cfg = await loadConfig(tmpPath);
    const result = findSession(cfg, 'x');
    expect(result).not.toBeNull();
    expect(result!.project.id).toBe('p1');
    expect(result!.session.id).toBe('x');
  });

  it('findSession returns null for unknown session', async () => {
    await fs.writeFile(tmpPath, JSON.stringify(newFormatConfig));
    const cfg = await loadConfig(tmpPath);
    expect(findSession(cfg, 'nope')).toBeNull();
  });
});
