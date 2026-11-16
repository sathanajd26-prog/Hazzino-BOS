import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Inter-process lock for the demo store.
 *
 * Prevents concurrent Next.js build workers, runtime processes, or test suites
 * from simultaneously removing, seeding, or writing to demo-data/ and demo-data/brain/.
 *
 * Placed outside demo-data/ so recursive removal of demo-data cannot delete the lock.
 */

export interface DemoLockPayload {
  lockId: string;
  pid: number;
  hostname: string;
  acquiredAt: number;
  createdAt: string;
  command?: string;
}

export interface DemoLockOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  lockPath?: string;
  onWait?: (elapsedMs: number) => void;
}

export function demoLockFile(): string {
  return process.env.GLADOS_DEMO_LOCK_FILE ?? path.join(process.cwd(), '.demo-store.lock');
}

let currentProcessLock: { lockId: string; lockPath: string } | null = null;

export function isDemoStoreLockHeldByCurrentProcess(lockPath?: string): boolean {
  if (currentProcessLock === null) return false;
  const targetPath = lockPath ?? currentProcessLock.lockPath;
  if (currentProcessLock.lockPath !== targetPath) return false;
  if (!fs.existsSync(targetPath)) {
    currentProcessLock = null;
    return false;
  }
  return true;
}

export function getCurrentProcessLockId(): string | null {
  return currentProcessLock?.lockId ?? null;
}

/** Reset lock state for the current process (for test isolation). */
export function resetCurrentProcessLockForTesting(): void {
  currentProcessLock = null;
}

function syncSleep(ms: number): void {
  try {
    const sab = new SharedArrayBuffer(4);
    const int32 = new Int32Array(sab);
    Atomics.wait(int32, 0, 0, ms);
  } catch {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Fallback synchronous spin if Atomics.wait is unavailable
    }
  }
}

/**
 * Acquire the demo store lock atomically.
 *
 * Uses O_CREAT | O_EXCL ('wx') so only one OS process can acquire it.
 * If held by another process, polls with synchronous sleep until timeout.
 * Fails closed on timeout without removing the existing lock or proceeding.
 */
export function acquireDemoStoreLock(options: DemoLockOptions = {}): { lockId: string; lockPath: string } {
  const lockPath = options.lockPath ?? demoLockFile();
  const timeoutMs = options.timeoutMs ?? (Number(process.env.GLADOS_DEMO_LOCK_TIMEOUT_MS) || 30_000);
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const startTime = Date.now();

  const lockId = `${process.pid}-${startTime}-${Math.random().toString(36).slice(2, 8)}`;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const payload: DemoLockPayload = {
        lockId,
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: Date.now(),
        createdAt: new Date().toISOString(),
        command: process.argv.slice(0, 3).join(' '),
      };
      fs.writeSync(fd, JSON.stringify(payload, null, 2) + '\n');
      fs.closeSync(fd);

      currentProcessLock = { lockId, lockPath };
      return { lockId, lockPath };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== 'EEXIST') {
        throw err;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        let existingLockInfo = 'unknown process';
        try {
          const raw = fs.readFileSync(lockPath, 'utf8');
          const data = JSON.parse(raw) as Partial<DemoLockPayload>;
          existingLockInfo = `PID ${data.pid ?? 'unknown'} (lockId: ${data.lockId ?? 'unknown'}, acquired at ${data.createdAt ?? 'unknown'}, command: "${data.command ?? 'unknown'}")`;
        } catch {
          // Leave existingLockInfo as unknown if file is unreadable
        }

        throw new Error(
          `[demo-store] Timed out waiting for demo store lock after ${timeoutMs}ms.\n` +
            `Lock path: ${lockPath}\n` +
            `Currently held by: ${existingLockInfo}\n` +
            `A concurrent rebuild may be in progress or a previous process may have terminated unexpectedly.\n` +
            `To recover safely if no process is running, manually remove the lock file:\n` +
            `  rm "${lockPath}"`,
        );
      }

      if (options.onWait) {
        options.onWait(elapsed);
      }

      syncSleep(pollIntervalMs);
    }
  }
}

/**
 * Release the demo store lock only if this process still owns it.
 */
export function releaseDemoStoreLock(lockPath = demoLockFile(), lockId?: string): boolean {
  const expectedLockId = lockId ?? currentProcessLock?.lockId;
  if (!expectedLockId) {
    return false;
  }

  try {
    if (!fs.existsSync(lockPath)) {
      if (currentProcessLock?.lockPath === lockPath) {
        currentProcessLock = null;
      }
      return false;
    }

    const raw = fs.readFileSync(lockPath, 'utf8');
    const data = JSON.parse(raw) as Partial<DemoLockPayload>;

    if (data.lockId === expectedLockId && data.pid === process.pid) {
      fs.unlinkSync(lockPath);
      if (currentProcessLock?.lockPath === lockPath) {
        currentProcessLock = null;
      }
      return true;
    }

    // Lock file belongs to another process or run; refuse to unlink
    return false;
  } catch {
    return false;
  }
}

/**
 * Execute an operation under the demo store lock.
 *
 * Supports re-entrancy for the owning process: if this process already owns the
 * lock, it proceeds immediately without attempting nested acquisition.
 */
export function withDemoStoreLock<T>(fn: () => T, options?: DemoLockOptions): T {
  const lockPath = options?.lockPath ?? demoLockFile();
  if (currentProcessLock !== null && currentProcessLock.lockPath === lockPath && fs.existsSync(lockPath)) {
    // Current process already holds the lock on this file; avoid nested acquisition
    return fn();
  }

  const handle = acquireDemoStoreLock(options);
  try {
    return fn();
  } finally {
    releaseDemoStoreLock(handle.lockPath, handle.lockId);
  }
}

process.once('exit', () => {
  if (currentProcessLock) {
    try {
      releaseDemoStoreLock(currentProcessLock.lockPath, currentProcessLock.lockId);
    } catch {
      // Best-effort cleanup during process exit
    }
  }
});
