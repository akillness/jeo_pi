import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAndSaveMemory } from '../save.js';
import { getCachedIndex, invalidateCache } from '../storage.js';
import { getBundleDir } from '../okf-bundle.js';

vi.mock('@mariozechner/pi-coding-agent', () => ({
  getAgentDir: vi.fn(),
}));

import { getAgentDir } from '@mariozechner/pi-coding-agent';

const mockedGetAgentDir = vi.mocked(getAgentDir);

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'workspace-memory-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createAndSaveMemory', () => {
  it('evicts over-limit memories and keeps index at 200', () => {
    const root = createTempRoot();
    mockedGetAgentDir.mockReturnValue(root);

    // cwd inside a temp dir so the mirrored OKF bundle (<cwd>/.jeo/memory) is isolated and cleaned up.
    const cwd = createTempRoot();

    for (let i = 0; i < 201; i += 1) {
      createAndSaveMemory({ content: `note ${i}` }, cwd);
    }

    invalidateCache(cwd);
    const index = getCachedIndex(cwd);
    expect(index.memories.length).toBe(200);
  });

  it('mirrors the saved memory into the OKF bundle (concept + index.md)', () => {
    const root = createTempRoot();
    mockedGetAgentDir.mockReturnValue(root);
    const cwd = createTempRoot();

    createAndSaveMemory(
      { content: 'Problem: boot crash\nRoot Cause: dup ext\nFix: remove one\nPrevention: register one', template: 'post-mortem', tags: ['startup'] },
      cwd
    );

    const bundle = getBundleDir(cwd);
    expect(existsSync(join(bundle, 'index.md'))).toBe(true);
    const index = readFileSync(join(bundle, 'index.md'), 'utf8');
    expect(index).toContain('okf_version: "0.1"');
    expect(index).toContain('## Post-mortems');
    expect(existsSync(join(bundle, 'log.md'))).toBe(true);
  });
});
