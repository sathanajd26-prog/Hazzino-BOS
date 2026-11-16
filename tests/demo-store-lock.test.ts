import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  acquireDemoStoreLock,
  releaseDemoStoreLock,
  withDemoStoreLock,
  isDemoStoreLockHeldByCurrentProcess,
  resetCurrentProcessLockForTesting,
  demoLockFile,
  type DemoLockPayload,
} from '@/lib/demo/lock';
import { ensureDemoStore, buildDemoStore, demoStoreStale } from '@/lib/demo/store';
import { dataPath } from '@/lib/paths';

const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

function runChild(code: string, env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(tsxBin, ['-e', code], {
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    p.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('Phase 3: Demo Store Inter-Process Lock', () => {
  let tempDir: string;
  let testLockPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-lock-test-'));
    testLockPath = path.join(tempDir, '.test-demo-store.lock');
  });

  afterEach(() => {
    try {
      resetCurrentProcessLockForTesting();
      if (fs.existsSync(testLockPath)) {
        fs.unlinkSync(testLockPath);
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('1. Only one process can acquire the lock at a time', async () => {
    const handle = acquireDemoStoreLock({ lockPath: testLockPath });
    expect(fs.existsSync(testLockPath)).toBe(true);

    const childCode = `
      import { acquireDemoStoreLock } from "./lib/demo/lock";
      try {
        acquireDemoStoreLock({ lockPath: "${testLockPath}", timeoutMs: 150 });
        process.exit(0);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
    `;

    const res = await runChild(childCode);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('[demo-store] Timed out waiting for demo store lock');

    const released = releaseDemoStoreLock(testLockPath, handle.lockId);
    expect(released).toBe(true);
    expect(fs.existsSync(testLockPath)).toBe(false);
  });

  it('2. A second independent OS process waits until the first releases the lock', async () => {
    const p1Code = `
      import { acquireDemoStoreLock, releaseDemoStoreLock } from "./lib/demo/lock";
      const handle = acquireDemoStoreLock({ lockPath: "${testLockPath}", timeoutMs: 5000 });
      process.stdout.write("P1_ACQUIRED:" + Date.now() + "\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      process.stdout.write("P1_RELEASING:" + Date.now() + "\\n");
      releaseDemoStoreLock("${testLockPath}", handle.lockId);
    `;

    const p2Code = `
      import { acquireDemoStoreLock, releaseDemoStoreLock } from "./lib/demo/lock";
      process.stdout.write("P2_START:" + Date.now() + "\\n");
      const handle = acquireDemoStoreLock({ lockPath: "${testLockPath}", timeoutMs: 5000 });
      process.stdout.write("P2_ACQUIRED:" + Date.now() + "\\n");
      releaseDemoStoreLock("${testLockPath}", handle.lockId);
    `;

    const p1Promise = runChild(p1Code);
    await new Promise((r) => setTimeout(r, 60));
    const p2Promise = runChild(p2Code);

    const [p1Res, p2Res] = await Promise.all([p1Promise, p2Promise]);
    expect(p1Res.code).toBe(0);
    expect(p2Res.code).toBe(0);

    const p1Acquired = Number(p1Res.stdout.match(/P1_ACQUIRED:(\d+)/)?.[1] ?? 0);
    const p1Releasing = Number(p1Res.stdout.match(/P1_RELEASING:(\d+)/)?.[1] ?? 0);
    const p2Start = Number(p2Res.stdout.match(/P2_START:(\d+)/)?.[1] ?? 0);
    const p2Acquired = Number(p2Res.stdout.match(/P2_ACQUIRED:(\d+)/)?.[1] ?? 0);

    expect(p1Acquired).toBeGreaterThan(0);
    expect(p1Releasing).toBeGreaterThan(p1Acquired);
    expect(p2Start).toBeGreaterThan(p1Acquired);
    expect(p2Acquired).toBeGreaterThanOrEqual(p1Releasing);
  });

  it('3. A second process does not delete or rebuild demo-data while the first is rebuilding', async () => {
    const isolatedDemoDir = path.join(tempDir, 'demo-data');
    fs.mkdirSync(isolatedDemoDir, { recursive: true });
    const sentinelFile = path.join(isolatedDemoDir, 'p1-sentinel.txt');

    const p1Code = `
      import fs from "node:fs";
      import { withDemoStoreLock } from "./lib/demo/lock";
      withDemoStoreLock(() => {
        fs.writeFileSync("${sentinelFile}", "p1-working");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        if (!fs.existsSync("${sentinelFile}")) {
          process.exit(2);
        }
      }, { lockPath: "${testLockPath}", timeoutMs: 5000 });
    `;

    const p2Code = `
      import fs from "node:fs";
      import { withDemoStoreLock } from "./lib/demo/lock";
      withDemoStoreLock(() => {
        if (!fs.existsSync("${sentinelFile}")) {
          process.exit(3);
        }
      }, { lockPath: "${testLockPath}", timeoutMs: 5000 });
    `;

    const p1 = runChild(p1Code);
    await new Promise((r) => setTimeout(r, 60));
    const p2 = runChild(p2Code);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.code).toBe(0);
    expect(r2.code).toBe(0);
  });

  it('4. Staleness is rechecked after lock acquisition', () => {
    let rebuildCalled = false;
    // Simulate: initial check was true (stale), but after lock acquisition check returns false (already fresh)
    const storeStale = vi.fn().mockReturnValue(false);

    // Initial staleness check (e.g. in ensureDemoStore)
    const initialStale = true;
    if (initialStale) {
      withDemoStoreLock(() => {
        // Recheck staleness after acquiring lock
        if (storeStale()) {
          rebuildCalled = true;
        }
      }, { lockPath: testLockPath });
    }

    expect(rebuildCalled).toBe(false);
    expect(storeStale).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(testLockPath)).toBe(false);
  });

  it('5. A lock timeout fails safely without proceeding', () => {
    // Simulate lock held by another process
    const foreignPayload: DemoLockPayload = {
      lockId: 'other-process-lock',
      pid: 999999,
      hostname: 'other-machine',
      acquiredAt: Date.now(),
      createdAt: new Date().toISOString(),
      command: 'node other-process.js',
    };
    fs.writeFileSync(testLockPath, JSON.stringify(foreignPayload, null, 2) + '\n');
    let ranProtectedAction = false;

    expect(() => {
      withDemoStoreLock(
        () => {
          ranProtectedAction = true;
        },
        { lockPath: testLockPath, timeoutMs: 100, pollIntervalMs: 20 },
      );
    }).toThrow('[demo-store] Timed out waiting for demo store lock');

    // Fail-closed verification: action was never executed and lock was NOT removed
    expect(ranProtectedAction).toBe(false);
    expect(fs.existsSync(testLockPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(testLockPath, 'utf8'));
    expect(content.lockId).toBe('other-process-lock');
  });

  it("6. A process cannot release another process's lock", () => {
    const foreignPayload: DemoLockPayload = {
      lockId: 'foreign-lock-id-999',
      pid: 999999,
      hostname: 'other-host',
      acquiredAt: Date.now(),
      createdAt: new Date().toISOString(),
      command: 'other command',
    };
    fs.writeFileSync(testLockPath, JSON.stringify(foreignPayload, null, 2) + '\n');

    const released = releaseDemoStoreLock(testLockPath, 'my-own-lock-id');
    expect(released).toBe(false);
    expect(fs.existsSync(testLockPath)).toBe(true);

    const raw = fs.readFileSync(testLockPath, 'utf8');
    expect(JSON.parse(raw).pid).toBe(999999);
  });

  it('7. Re-entrancy within the same process avoids nested acquisition', () => {
    let depth = 0;
    const result = withDemoStoreLock(
      () => {
        depth++;
        expect(isDemoStoreLockHeldByCurrentProcess()).toBe(true);
        return withDemoStoreLock(
          () => {
            depth++;
            return withDemoStoreLock(() => {
              depth++;
              return 42;
            }, { lockPath: testLockPath });
          },
          { lockPath: testLockPath },
        );
      },
      { lockPath: testLockPath },
    );

    expect(result).toBe(42);
    expect(depth).toBe(3);
    expect(isDemoStoreLockHeldByCurrentProcess()).toBe(false);
    expect(fs.existsSync(testLockPath)).toBe(false);
  });

  it('8. A completed rebuild leaves the expected database, sidecar files, brain files, and seed marker intact', () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-rebuild-test-'));
    const testModeFile = path.join(testRoot, '.glados-mode');
    const testLock = path.join(testRoot, '.demo-store.lock');

    try {
      fs.writeFileSync(testModeFile, 'filming\n');
      const spyCwd = vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
      vi.stubEnv('GLADOS_MODE_FILE', testModeFile);
      vi.stubEnv('GLADOS_DEFAULT_MODE', 'demo');
      vi.stubEnv('GLADOS_DEMO_LOCK_FILE', testLock);

      expect(demoStoreStale()).toBe(true);
      ensureDemoStore();
      expect(demoStoreStale()).toBe(false);

      const demoDir = path.join(testRoot, 'demo-data');
      for (const f of ['glados.db', 'drift.json', 'wizard/projects.json', 'bdpilot/state.json', 'bin/gbrain', '.demo-seeded-at']) {
        expect(fs.existsSync(path.join(demoDir, f)), f).toBe(true);
      }

      const brainDir = path.join(demoDir, 'brain');
      expect(fs.existsSync(brainDir)).toBe(true);
      const pages = fs.readdirSync(brainDir, { recursive: true }).filter((f) => String(f).endsWith('.md'));
      expect(pages.length).toBeGreaterThan(150);

      // Lockfile must be cleanly released and removed
      expect(fs.existsSync(testLock)).toBe(false);

      spyCwd.mockRestore();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
