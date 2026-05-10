import { readSyncStatus, writeSyncStatus } from "@/lib/store";
import type { SecuritySyncCooldownStatus, SyncStatusSnapshot, SyncTaskKind, SyncTaskStatus } from "@/lib/types";

type QueueTask = {
  key: string;
  kind: SyncTaskKind;
  label: string;
  run: () => Promise<void>;
  attempts: number;
  maxAttempts?: number;
};

type QueueState = {
  initialized: boolean;
  processing: boolean;
  tasks: QueueTask[];
  taskMap: Map<string, QueueTask>;
  alphaVantageLastRequestAt: number;
};

const MAX_TASK_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 60000;
export const SECURITY_SYNC_COOLDOWN_MS = 60 * 60 * 1000;

const DEFAULT_STATUS: SyncStatusSnapshot = {
  updatedAt: new Date(0).toISOString(),
  queueLength: 0,
  runningCount: 0,
  tasks: [],
  securityCooldowns: [],
};

function getQueueState() {
  const globalState = globalThis as typeof globalThis & {
    __assetflowSyncQueueState?: QueueState;
  };

  if (!globalState.__assetflowSyncQueueState) {
    globalState.__assetflowSyncQueueState = {
      initialized: false,
      processing: false,
      tasks: [],
      taskMap: new Map<string, QueueTask>(),
      alphaVantageLastRequestAt: 0,
    };
  }

  return globalState.__assetflowSyncQueueState;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSecuritySymbol(value: string) {
  return value.trim().toUpperCase();
}

function activeSecurityCooldowns(cooldowns: SecuritySyncCooldownStatus[]) {
  const now = Date.now();
  return cooldowns.filter((cooldown) => new Date(cooldown.nextAllowedAt).getTime() > now);
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableRateLimitError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /rate limit|call frequency|5 calls per minute|premium feature/i.test(error.message);
}

function getRetryDelay(error: unknown, attempt: number) {
  if (isRetryableRateLimitError(error)) {
    return Math.min(MAX_RETRY_DELAY_MS, 15000 * attempt);
  }

  return Math.min(MAX_RETRY_DELAY_MS, 10000 * attempt);
}

async function ensureInitialized() {
  const state = getQueueState();
  if (state.initialized) {
    return;
  }

  const snapshot = await readSyncStatus().catch(() => DEFAULT_STATUS);
  const retainedTasks = snapshot.tasks.filter((task) => task.state === "succeeded" || task.state === "failed");
  await writeSyncStatus({
    updatedAt: nowIso(),
    queueLength: 0,
    runningCount: 0,
    lastError: retainedTasks.find((task) => task.state === "failed" && task.errorMessage)?.errorMessage,
    tasks: retainedTasks,
    securityCooldowns: activeSecurityCooldowns(snapshot.securityCooldowns),
  });
  state.initialized = true;
}

async function updateSnapshot(mutator: (snapshot: SyncStatusSnapshot) => SyncStatusSnapshot) {
  const current = await readSyncStatus().catch(() => DEFAULT_STATUS);
  const next = mutator(current);
  await writeSyncStatus(next);
}

async function upsertTaskStatus(task: Partial<SyncTaskStatus> & Pick<SyncTaskStatus, "key" | "kind" | "label" | "state">) {
  await updateSnapshot((snapshot) => {
    const existingIndex = snapshot.tasks.findIndex((item) => item.key === task.key);
    const existing = existingIndex >= 0 ? snapshot.tasks[existingIndex] : undefined;
    const nextTask: SyncTaskStatus = {
      key: task.key,
      kind: task.kind,
      label: task.label,
      state: task.state,
      attempts: task.attempts ?? existing?.attempts ?? 0,
      queuedAt: task.queuedAt ?? existing?.queuedAt ?? nowIso(),
      startedAt: task.startedAt ?? existing?.startedAt,
      finishedAt: task.finishedAt ?? existing?.finishedAt,
      updatedAt: task.updatedAt ?? nowIso(),
      nextRetryAt: task.nextRetryAt,
      errorMessage: task.errorMessage,
    };
    const tasks = [...snapshot.tasks];
    if (existingIndex >= 0) {
      tasks[existingIndex] = nextTask;
    } else {
      tasks.unshift(nextTask);
    }

    const queuedCount = tasks.filter((item) => item.state === "queued" || item.state === "retrying").length;
    const runningCount = tasks.filter((item) => item.state === "running").length;
    const failedTask = tasks.find((item) => item.state === "failed" && item.errorMessage);

    return {
      updatedAt: nowIso(),
      queueLength: queuedCount,
      runningCount,
      lastError: failedTask?.errorMessage,
      tasks: tasks.slice(0, 16),
      securityCooldowns: snapshot.securityCooldowns,
    };
  });
}

async function markTaskRemoved(taskKey: string) {
  await updateSnapshot((snapshot) => {
    const tasks = snapshot.tasks.filter((item) => item.key !== taskKey);
    return {
      updatedAt: nowIso(),
      queueLength: tasks.filter((item) => item.state === "queued" || item.state === "retrying").length,
      runningCount: tasks.filter((item) => item.state === "running").length,
      lastError: tasks.find((item) => item.state === "failed" && item.errorMessage)?.errorMessage,
      tasks,
      securityCooldowns: snapshot.securityCooldowns,
    };
  });
}

async function reconcileSnapshotWithQueueState() {
  const state = getQueueState();
  await updateSnapshot((snapshot) => {
    const liveTaskKeys = new Set(state.taskMap.keys());
    const tasks = snapshot.tasks.filter((task) => {
      if (task.state === "succeeded" || task.state === "failed") {
        return true;
      }

      return liveTaskKeys.has(task.key);
    });

    return {
      updatedAt: nowIso(),
      queueLength: tasks.filter((task) => task.state === "queued" || task.state === "retrying").length,
      runningCount: tasks.filter((task) => task.state === "running").length,
      lastError: tasks.find((task) => task.state === "failed" && task.errorMessage)?.errorMessage,
      tasks,
      securityCooldowns: activeSecurityCooldowns(snapshot.securityCooldowns),
    };
  });
}

function scheduleRetry(task: QueueTask, nextDelay: number) {
  const state = getQueueState();
  const retryTask: QueueTask = {
    ...task,
    attempts: task.attempts + 1,
  };

  state.taskMap.set(retryTask.key, retryTask);

  setTimeout(() => {
    const liveState = getQueueState();
    if (!liveState.taskMap.has(retryTask.key)) {
      return;
    }

    liveState.tasks.push(retryTask);
    void upsertTaskStatus({
      key: retryTask.key,
      kind: retryTask.kind,
      label: retryTask.label,
      state: "queued",
      attempts: retryTask.attempts,
      updatedAt: nowIso(),
    }).then(() => {
      void processQueue();
    });
  }, nextDelay);
}

async function processQueue() {
  const state = getQueueState();
  if (state.processing) {
    return;
  }

  state.processing = true;

  while (state.tasks.length) {
    const task = state.tasks.shift();
    if (!task) {
      break;
    }

    await upsertTaskStatus({
      key: task.key,
      kind: task.kind,
      label: task.label,
      state: "running",
      attempts: task.attempts + 1,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      errorMessage: undefined,
      nextRetryAt: undefined,
    });

    try {
      await task.run();
      state.taskMap.delete(task.key);
      await upsertTaskStatus({
        key: task.key,
        kind: task.kind,
        label: task.label,
        state: "succeeded",
        attempts: task.attempts + 1,
        finishedAt: nowIso(),
        updatedAt: nowIso(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";

      const maxAttempts = task.maxAttempts ?? MAX_TASK_ATTEMPTS;
      if (task.attempts + 1 < maxAttempts) {
        const nextDelay = getRetryDelay(error, task.attempts + 1);
        await upsertTaskStatus({
          key: task.key,
          kind: task.kind,
          label: task.label,
          state: "retrying",
          attempts: task.attempts + 1,
          updatedAt: nowIso(),
          nextRetryAt: new Date(Date.now() + nextDelay).toISOString(),
          errorMessage: message,
        });
        scheduleRetry(task, nextDelay);
        continue;
      }

      state.taskMap.delete(task.key);
      await upsertTaskStatus({
        key: task.key,
        kind: task.kind,
        label: task.label,
        state: "failed",
        attempts: task.attempts + 1,
        finishedAt: nowIso(),
        updatedAt: nowIso(),
        errorMessage: message,
      });
    }
  }

  state.processing = false;
}

export async function enqueueSyncTask(task: Omit<QueueTask, "attempts">) {
  await ensureInitialized();
  const state = getQueueState();
  const existing = state.taskMap.get(task.key);
  if (existing) {
    return false;
  }

  const queueTask: QueueTask = {
    ...task,
    attempts: 0,
  };

  state.tasks.push(queueTask);
  state.taskMap.set(queueTask.key, queueTask);
  await upsertTaskStatus({
    key: queueTask.key,
    kind: queueTask.kind,
    label: queueTask.label,
    state: "queued",
    attempts: 0,
    queuedAt: nowIso(),
    updatedAt: nowIso(),
  });
  void processQueue();
  return true;
}

export async function getSyncStatusSnapshot() {
  await ensureInitialized();
  await reconcileSnapshotWithQueueState();
  return readSyncStatus();
}

export async function clearFinishedSyncTask(taskKey: string) {
  await ensureInitialized();
  await markTaskRemoved(taskKey);
}

export async function getSecuritySyncCooldown(symbol: string) {
  await ensureInitialized();
  const normalizedSymbol = normalizeSecuritySymbol(symbol);
  const snapshot = await readSyncStatus();
  const cooldown = activeSecurityCooldowns(snapshot.securityCooldowns).find(
    (item) => item.symbol === normalizedSymbol,
  );

  if (!cooldown) {
    return null;
  }

  return cooldown;
}

export async function recordSecuritySyncCooldown(input: {
  symbol: string;
  label: string;
  reason?: string;
  attemptedAt?: Date;
}) {
  await ensureInitialized();
  const symbol = normalizeSecuritySymbol(input.symbol);
  const attemptedAt = input.attemptedAt ?? new Date();
  const nextAllowedAt = new Date(attemptedAt.getTime() + SECURITY_SYNC_COOLDOWN_MS).toISOString();

  await updateSnapshot((snapshot) => {
    const remainingCooldowns = activeSecurityCooldowns(snapshot.securityCooldowns).filter(
      (item) => item.symbol !== symbol,
    );

    return {
      ...snapshot,
      updatedAt: nowIso(),
      securityCooldowns: [
        {
          symbol,
          label: input.label,
          lastAttemptAt: attemptedAt.toISOString(),
          nextAllowedAt,
          reason: input.reason,
        },
        ...remainingCooldowns,
      ],
    };
  });
}

export async function clearSecuritySyncCooldown(symbol?: string) {
  await ensureInitialized();
  const normalizedSymbol = symbol ? normalizeSecuritySymbol(symbol) : null;

  await updateSnapshot((snapshot) => ({
    ...snapshot,
    updatedAt: nowIso(),
    securityCooldowns: normalizedSymbol
      ? snapshot.securityCooldowns.filter((item) => item.symbol !== normalizedSymbol)
      : [],
  }));
}

export async function withAlphaVantageThrottle<T>(run: () => Promise<T>) {
  const state = getQueueState();
  const now = Date.now();
  const minGapMs = 15000;
  const waitMs = Math.max(0, minGapMs - (now - state.alphaVantageLastRequestAt));
  if (waitMs > 0) {
    await delay(waitMs);
  }

  state.alphaVantageLastRequestAt = Date.now();
  return run();
}
