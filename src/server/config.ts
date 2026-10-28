import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PublicConfig, Provider, SessionPatch, SttBackend, NewSessionPayload, NewProjectPayload } from '../../shared/protocol.js';
import { writeJsonAtomic } from './fs-util.js';
import { createKeyedSerialQueue } from './serial-queue.js';

const SessionSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  emoji: z.string().max(64).optional(),
  project_dir: z.string().min(1).max(4096),
  lang: z.string().max(128).optional(),
  voice_mode: z.boolean().optional().default(true),
  tts_rate: z.number().min(0.5).max(3.0).optional().default(1.2),
  /** Which Claude backend handles this session. */
  provider: z.enum(['subscription', 'anthropic-api', 'openrouter', 'codex']).optional().default('subscription'),
  /** Model name. Required when provider='openrouter'. */
  model: z.string().max(512).optional(),
  /**
   * How the Claude Code subprocess handles tool permissions. Defaults to
   * 'bypassPermissions' because the hands-free driving flow has no way to
   * answer a mid-turn prompt; set to 'default'/'plan'/'dontAsk' to lock down.
   */
  permission_mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
  /** STT backend: 'browser' uses Web Speech API (default); 'server' uses whisper.cpp. */
  stt_backend: z.enum(['browser', 'server']).optional().default('browser'),
  archived: z.boolean().optional(),
}).refine(
  (s) => s.provider !== 'openrouter' || !!s.model,
  { message: 'model is required when provider is openrouter', path: ['model'] },
);

const ProjectSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  emoji: z.string().max(64).optional(),
  sessions: z.array(SessionSchema),
});

const ConfigSchema = z.object({
  projects: z.array(ProjectSchema),
}).superRefine((cfg, ctx) => {
  const projectIds = new Set<string>();
  const sessionIds = new Set<string>();
  cfg.projects.forEach((project, projectIndex) => {
    if (projectIds.has(project.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['projects', projectIndex, 'id'],
        message: `duplicate project id: ${project.id}`,
      });
    }
    projectIds.add(project.id);

    project.sessions.forEach((session, sessionIndex) => {
      // Session ids are addressed globally by every wire message, so allowing
      // the same id in two projects makes routing and archive/update ambiguous.
      if (sessionIds.has(session.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['projects', projectIndex, 'sessions', sessionIndex, 'id'],
          message: `duplicate session id: ${session.id}`,
        });
      }
      sessionIds.add(session.id);
    });
  });
});

export type Config = z.infer<typeof ConfigSchema>;
export type SessionConfig = Config['projects'][number]['sessions'][number];
export type ProjectConfig = z.infer<typeof ProjectSchema>;

/** One read-modify-write operation per config path at a time. */
const configMutationQueue = createKeyedSerialQueue();

function withConfigMutation<T>(p: string, operation: () => Promise<T>): Promise<T> {
  return configMutationQueue(path.resolve(p), operation);
}

export function migrateLegacyConfig(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r['sessions']) && !Array.isArray(r['projects'])) {
      return {
        projects: [{
          id: 'default',
          label: 'Projects',
          color: '#3b82f6',
          sessions: r['sessions'],
        }],
      };
    }
  }
  return raw;
}

export async function loadConfig(p: string): Promise<Config> {
  const raw = await fs.readFile(p, 'utf-8');
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed JSON in ${p}: ${detail}`, { cause: error });
  }
  const migrated = migrateLegacyConfig(json);
  return ConfigSchema.parse(migrated);
}

export function toPublic(cfg: Config): PublicConfig {
  return {
    projects: cfg.projects.map((proj) => ({
      id: proj.id,
      label: proj.label,
      color: proj.color,
      emoji: proj.emoji,
      sessions: proj.sessions
        .filter((s) => !s.archived)
        .map((s) => ({
          id: s.id,
          label: s.label,
          color: s.color,
          emoji: s.emoji,
          lang: s.lang,
          tts_rate: s.tts_rate,
          voice_mode: s.voice_mode,
          provider: s.provider as Provider,
          model: s.model,
          stt_backend: s.stt_backend as SttBackend | undefined,
        })),
    })),
  };
}

export function findSession(cfg: Config, sessionId: string): { project: ProjectConfig; session: SessionConfig } | null {
  for (const project of cfg.projects) {
    const session = project.sessions.find((s) => s.id === sessionId);
    if (session) return { project, session };
  }
  return null;
}

/** Whitelist of fields the phone can patch per session. Validates the wire-protocol `SessionPatch`. */
export const SessionPatchSchema = z.strictObject({
  tts_rate: z.number().min(0.5).max(3.0).optional(),
  lang: z.string().max(128).optional(),
  voice_mode: z.boolean().optional(),
  provider: z.enum(['subscription', 'anthropic-api', 'openrouter', 'codex']).optional(),
  model: z.string().max(512).optional(),
  stt_backend: z.enum(['browser', 'server']).optional(),
});

// Compile-time guard: if SessionPatch (wire type) ever gains a field that
// SessionPatchSchema doesn't, this line will fail tsc.
const _SessionPatchTypeCheck: z.ZodType<SessionPatch> = SessionPatchSchema;
void _SessionPatchTypeCheck;

/** Atomically update a single session in the config file. */
export async function updateSession(p: string, sessionId: string, patch: SessionPatch): Promise<void> {
  let parsed: SessionPatch;
  try {
    parsed = SessionPatchSchema.parse(patch);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const detail = e.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
      throw new Error(`Patch contains fields not allowed for per-session update: ${detail}`);
    }
    throw e;
  }
  await withConfigMutation(p, async () => {
    const cfg = await loadConfig(p);
    let found = false;
    for (const proj of cfg.projects) {
      const idx = proj.sessions.findIndex((s) => s.id === sessionId);
      if (idx >= 0) {
        proj.sessions[idx] = { ...proj.sessions[idx], ...parsed };
        found = true;
        break;
      }
    }
    if (!found) throw new Error(`Unknown session: ${sessionId}`);

    const finalCfg = ConfigSchema.parse(cfg);

    await writeJsonAtomic(p, finalCfg);
  });
}

export async function addSession(p: string, projectId: string, payload: NewSessionPayload): Promise<SessionConfig> {
  return withConfigMutation(p, async () => {
    const cfg = await loadConfig(p);
    const proj = cfg.projects.find((pr) => pr.id === projectId);
    if (!proj) throw new Error(`Unknown project: ${projectId}`);

    const newSession: SessionConfig = SessionSchema.parse({
      id: crypto.randomUUID(),
      label: payload.label,
      color: payload.color,
      emoji: payload.emoji,
      project_dir: payload.project_dir,
      provider: payload.provider ?? 'subscription',
      model: payload.model,
    });

    proj.sessions.push(newSession);
    const finalCfg = ConfigSchema.parse(cfg);

    await writeJsonAtomic(p, finalCfg);

    return newSession;
  });
}

export async function addProject(p: string, payload: NewProjectPayload): Promise<ProjectConfig> {
  return withConfigMutation(p, async () => {
    const cfg = await loadConfig(p);

    const newProject: ProjectConfig = ProjectSchema.parse({
      id: crypto.randomUUID(),
      label: payload.label,
      color: payload.color,
      emoji: payload.emoji,
      sessions: [],
    });

    cfg.projects.push(newProject);
    const finalCfg = ConfigSchema.parse(cfg);

    await writeJsonAtomic(p, finalCfg);

    return newProject;
  });
}

export async function archiveSession(p: string, sessionId: string): Promise<void> {
  await withConfigMutation(p, async () => {
    const cfg = await loadConfig(p);
    const result = findSession(cfg, sessionId);
    if (!result) throw new Error(`Unknown session: ${sessionId}`);

    const { project } = result;
    const idx = project.sessions.findIndex((s) => s.id === sessionId);
    project.sessions[idx] = { ...project.sessions[idx], archived: true };

    const finalCfg = ConfigSchema.parse(cfg);

    await writeJsonAtomic(p, finalCfg);
  });
}

export async function unarchiveSession(p: string, sessionId: string): Promise<void> {
  await withConfigMutation(p, async () => {
    const cfg = await loadConfig(p);
    const result = findSession(cfg, sessionId);
    if (!result) throw new Error(`Unknown session: ${sessionId}`);

    const { project } = result;
    const idx = project.sessions.findIndex((s) => s.id === sessionId);
    const { archived: _removed, ...rest } = project.sessions[idx];
    project.sessions[idx] = rest as SessionConfig;

    const finalCfg = ConfigSchema.parse(cfg);

    await writeJsonAtomic(p, finalCfg);
  });
}
