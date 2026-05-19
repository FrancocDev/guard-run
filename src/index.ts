/**
 * guard-run — CLI task runner with guard-based pre/post conditions.
 *
 * @packageDocumentation
 */

// ── Types ───────────────────────────────────────────────────────

export type {
  TaskName,
  StepName,
  TaskDef,
  GuardError,
  TaskError,
  CycleError,
  GuardRunError,
} from "./types.js";

// ── Task Builder ────────────────────────────────────────────────

export type { TaskBuilder } from "./task.js";
export { task } from "./task.js";

// ── DAG Engine ──────────────────────────────────────────────────

export { validateDAG, executeSequential } from "./dag.js";
