/**
 * @knots/core — The heart of KNOTS.
 * Exports knot management, storage, run lifecycle, and credentials.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';

import { KnotLibrary } from './knot/index.js';
import { KnotsDatabase, StrandStore, LaneStore, RunStore, SettingsStore } from './storage/index.js';
import { RunManager } from './run/index.js';
import { CredentialManager } from './credentials/index.js';

// Knot exports
export {
  KnotLibrary,
  knotSystemPrompt,
  loadKnot,
  serializeKnot,
  validateKnotSpec,
  knotSchemaV0,
  KnotLoadError,
  type LoadedKnot,
  type KnotMeta,
  type SaveKnotOptions,
} from './knot/index.js';

// Storage exports
export {
  KnotsDatabase,
  Database,
  type DatabaseConfig,
  StrandStore,
  type CreateStrandInput,
  type UpdateStrandInput,
  LaneStore,
  type StoredLane,
  type CreateLaneInput,
  type UpdateLaneInput,
  RunStore,
  type CreateRunInput,
  type UpdateRunInput,
  SettingsStore,
} from './storage/index.js';

// Run exports
export {
  RunManager,
  type RunManagerConfig,
  type CreateRunOptions,
  RunContext,
  type RunContextOptions,
  type RunStartedEvent,
  type RunProgressEvent,
  type RunChunkEvent,
  type RunCompletedEvent,
  type RunFailedEvent,
  type RunCancelledEvent,
  type RunLifecycleEvent,
  type RunEventListener,
} from './run/index.js';

// Credentials exports
export { CredentialManager, type CredentialManagerConfig } from './credentials/index.js';

/**
 * Composite core instance returned by createCore.
 */
export interface KnotsCore {
  dataDir: string;
  database: KnotsDatabase;
  knots: KnotLibrary;
  knotLibrary: KnotLibrary;
  strands: StrandStore;
  strandStore: StrandStore;
  lanes: LaneStore;
  laneStore: LaneStore;
  runs: RunStore;
  runStore: RunStore;
  settings: SettingsStore;
  settingsStore: SettingsStore;
  credentials: CredentialManager;
  credentialManager: CredentialManager;
  runManager: RunManager;
  close(): void;
}

export interface CreateCoreOptions {
  /** Custom path for SQLite database file (defaults to <dataDir>/knots.db) */
  dbPath?: string;
  /** Custom path for knots library directory (defaults to <dataDir>/knots) */
  knotsDir?: string;
}

/**
 * Initialize all core subsystems rooted at dataDir.
 */
export function createCore(dataDir: string, options?: CreateCoreOptions): KnotsCore {
  const resolvedDataDir = path.resolve(dataDir);
  if (!fs.existsSync(resolvedDataDir)) {
    fs.mkdirSync(resolvedDataDir, { recursive: true });
  }

  const dbPath = options?.dbPath ?? path.join(resolvedDataDir, 'knots.db');
  const knotsDir = options?.knotsDir ?? path.join(resolvedDataDir, 'knots');

  const database = new KnotsDatabase({ dbPath });
  const rawDb = database.getDb();

  const strands = new StrandStore(rawDb);
  const lanes = new LaneStore(rawDb);
  const runs = new RunStore(rawDb);
  const settings = new SettingsStore(rawDb);
  const knots = new KnotLibrary(knotsDir);
  const credentials = new CredentialManager({ dataDir: resolvedDataDir });
  const runManager = new RunManager({ runStore: runs });

  return {
    dataDir: resolvedDataDir,
    database,
    knots,
    knotLibrary: knots,
    strands,
    strandStore: strands,
    lanes,
    laneStore: lanes,
    runs,
    runStore: runs,
    settings,
    settingsStore: settings,
    credentials,
    credentialManager: credentials,
    runManager,
    close: () => {
      database.close();
    },
  };
}

export {
  getStrandApiKeyRef,
  getProviderEnvVarName,
  resolveEnvApiKey,
  resolveApiKey,
  resolveDefaultStrand,
} from './connections.js';
export { KnotWorker, type JobInput } from './run/worker.js';
export { selectKnot, type KnotPlan } from './run/planner.js';
export {
  ModelRouter,
  callReceipts,
  type CallReceipt,
  type ProviderResolver,
} from './routing/router.js';

export { KnotTeaching } from './teaching.js';

export { requestWorkerStop, controlledProvider } from './run/worker-control.js';

export {
  KnotPlans,
  validateTaskPlan,
  type TaskPlan,
  type PlanTask,
  type TaskGrant,
} from './run/plans.js';
