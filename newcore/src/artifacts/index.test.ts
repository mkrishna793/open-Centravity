// ═══════════════════════════════════════════════════════════════
// ArtifactStore — Unit Tests
//
// Regression guard for issue #17 (ERR_MODULE_NOT_FOUND).
// Ensures ArtifactStore is importable and its factory methods
// return correctly shaped ArtifactData objects.
// ═══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, expect, vi } from 'vitest';

// ── Module mock ──
// ArtifactStore calls getConfig() + performs fs I/O + writes to the
// DB. We mock all of those so the unit tests are fast and hermetic.

vi.mock('../config/index.js', () => ({
  getConfig: () => ({ artifactsDir: '/tmp/test-artifacts' }),
}));

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('{}'),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

vi.mock('../db/tables/artifacts.js', () => ({
  insert: vi.fn().mockResolvedValue('mock-db-id'),
  search: vi.fn().mockResolvedValue([]),
}));

vi.mock('../db/index.js', () => ({
  trackPromise: vi.fn((p: Promise<unknown>) => p),
}));

// ── Import under test (after mocks are registered) ──

import { ArtifactStore } from './index.js';

// ── Helpers ──

const AGENT_ID = 'test-agent-1';

const MOCK_PLAN = {
  taskDescription: 'Fix the build',
  reasoning: 'The artifacts module was missing',
  estimatedComplexity: 'low' as const,
  steps: [
    { id: 1, description: 'Create index.ts', tool: 'write_file', toolInput: {}, dependsOn: [], status: 'pending' as const },
  ],
};

// ── Tests ──

describe('ArtifactStore', () => {
  let store: ArtifactStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ArtifactStore();
  });

  it('should be importable without ERR_MODULE_NOT_FOUND (regression: issue #17)', () => {
    expect(ArtifactStore).toBeDefined();
    expect(typeof ArtifactStore).toBe('function');
  });

  it('should instantiate without throwing', () => {
    expect(() => new ArtifactStore()).not.toThrow();
  });

  describe('createPlanArtifact()', () => {
    it('returns an ArtifactData with type \'execution_plan\'', () => {
      const artifact = store.createPlanArtifact(AGENT_ID, MOCK_PLAN);

      expect(artifact.id).toMatch(/^plan-/);
      expect(artifact.agentId).toBe(AGENT_ID);
      expect(artifact.type).toBe('execution_plan');
      expect(artifact.title).toBe('Execution Plan');
      expect(JSON.parse(artifact.content)).toMatchObject(MOCK_PLAN);
      expect(artifact.metadata.stepCount).toBe(1);
      expect(artifact.createdAt).toBeGreaterThan(0);
    });

    it('persists the artifact via save()', async () => {
      const writeMock = vi.mocked(await import('fs')).writeFileSync as ReturnType<typeof vi.fn>;
      store.createPlanArtifact(AGENT_ID, MOCK_PLAN);
      expect(writeMock).toHaveBeenCalledOnce();
    });
  });

  describe('createLogArtifact()', () => {
    it('returns an ArtifactData with type \'log\'', () => {
      const artifact = store.createLogArtifact(AGENT_ID, 'Step 1 log', 'step output here');

      expect(artifact.id).toMatch(/^log-/);
      expect(artifact.agentId).toBe(AGENT_ID);
      expect(artifact.type).toBe('log');
      expect(artifact.title).toBe('Step 1 log');
      expect(artifact.content).toBe('step output here');
    });
  });

  describe('createDiffArtifact()', () => {
    it('returns an ArtifactData with type \'diff\'', () => {
      const artifact = store.createDiffArtifact(
        AGENT_ID,
        'newcore/src/artifacts/index.ts',
        'old content\nline 2',
        'new content\nline 2',
      );

      expect(artifact.type).toBe('diff');
      expect(artifact.metadata.filePath).toBe('newcore/src/artifacts/index.ts');
      expect(artifact.content).toContain('-old content');
      expect(artifact.content).toContain('+new content');
      expect(artifact.content).toContain(' line 2');
    });
  });

  describe('get()', () => {
    it('returns the artifact by agentId + artifactId', async () => {
      const artifact = store.createLogArtifact(AGENT_ID, 'title', 'body');
      // Simulate file read returning the artifact
      vi.mocked(await import('fs')).readFileSync = vi.fn().mockReturnValue(
        JSON.stringify(artifact),
      );
      const retrieved = store.get(AGENT_ID, artifact.id);
      expect(retrieved).toMatchObject({ id: artifact.id, type: 'log' });
    });

    it('returns null when the file does not exist', async () => {
      vi.mocked(await import('fs')).existsSync = vi.fn().mockReturnValue(false);
      expect(store.get(AGENT_ID, 'does-not-exist')).toBeNull();
    });
  });

  describe('listByAgent()', () => {
    it('returns an empty array when the agent directory does not exist', async () => {
      vi.mocked(await import('fs')).existsSync = vi.fn().mockReturnValue(false);
      expect(store.listByAgent(AGENT_ID)).toEqual([]);
    });

    it('returns parsed artifact objects sorted by createdAt descending', async () => {
      const older = store.createLogArtifact(AGENT_ID, 'older', 'a');
      // ensure distinct timestamps
      const newer = { ...older, id: 'log-99999999999', createdAt: older.createdAt + 1000, title: 'newer' };

      vi.mocked(await import('fs')).existsSync = vi.fn().mockReturnValue(true);
      vi.mocked(await import('fs')).readdirSync = vi.fn().mockReturnValue([
        `${older.id}.json`,
        `${newer.id}.json`,
      ]);
      vi.mocked(await import('fs')).readFileSync = vi.fn()
        .mockReturnValueOnce(JSON.stringify(older))
        .mockReturnValueOnce(JSON.stringify(newer));

      const list = store.listByAgent(AGENT_ID);
      expect(list[0].id).toBe(newer.id);
      expect(list[1].id).toBe(older.id);
    });
  });
});
