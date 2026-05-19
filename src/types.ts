import type { Branded } from "@francocdev/ts-patterns/brand";
import type { Guard } from "@francocdev/ts-patterns/guards";
import type { Result } from "@francocdev/ts-patterns/result";

// ── Branded types ──────────────────────────────────────────────

/** Nominal type for a task name — distinct from plain `string`. */
export type TaskName = Branded<string, "TaskName">;

/** Nominal type for a validated step — distinct from plain `string`. */
export type StepName = Branded<string, "StepName">;

// ── Task definition ────────────────────────────────────────────

/** Descriptor produced by the task builder after `.build()`. */
export interface TaskDef<T = unknown> {
  name: TaskName;
  pre: Guard<T>[];
  run: (ctx: T) => Result<T, GuardRunError>;
  post: Guard<T>[];
  dependencies: TaskName[];
}

// ── Error types (discriminated union via _tag) ─────────────────

/** A guard check failed during task execution. */
export interface GuardError {
  _tag: "GuardError";
  task: TaskName;
  guard: string;
  message: string;
  context: unknown;
}

/** A task's run function threw or returned a failure. */
export interface TaskError {
  _tag: "TaskError";
  task: TaskName;
  message: string;
  cause: unknown;
}

/** Discriminated union of all known error types. */
export type GuardRunError = GuardError | TaskError;
