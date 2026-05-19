/**
 * Compile-time type assertions for guard-run types.
 *
 * These tests verify that TypeScript rejects invalid assignments at
 * compile time. Run via `tsc --noEmit` — zero errors means the
 * brand isolation and discriminated unions are correct.
 *
 * Each `@ts-expect-error` MUST produce a type error. If any line
 * BELOW a `@ts-expect-error` unexpectedly compiles, `tsc --noEmit`
 * will report an "Unused '@ts-expect-error' directive" error.
 */

import type { CycleError, GuardError, StepName, TaskError, TaskName } from "./types.js";

// ── Brand isolation: TaskName ───────────────────────────────────

// Explicit cast is required to produce a TaskName from a string literal.
const _validTask: TaskName = "build" as TaskName;

// A plain string literal MUST NOT be assignable to TaskName.
// @ts-expect-error — string is not assignable to Branded<string, "TaskName">
const _invalidTask: TaskName = "build";

// ── Brand isolation: string ≠ TaskName ──────────────────────────

function fnExpectingTaskName(_t: TaskName): void {
  /* no-op */
}

// Calling with a plain string MUST be rejected.
// @ts-expect-error — Argument of type 'string' is not assignable to parameter of type 'TaskName'
fnExpectingTaskName("build");

// Calling with an explicit cast IS valid.
fnExpectingTaskName("build" as TaskName);

// ── Brand isolation: StepName ──────────────────────────────────

// Explicit cast is required to produce a StepName from a string literal.
const _validStep: StepName = "validate" as StepName;

// A plain string literal MUST NOT be assignable to StepName.
// @ts-expect-error — string is not assignable to Branded<string, "StepName">
const _invalidStep: StepName = "validate";

// ── Cross-brand isolation: TaskName ≠ StepName ──────────────────

// TaskName and StepName MUST be incompatible.
// @ts-expect-error — Type 'Branded<string, "TaskName">' is not assignable to type 'StepName'
const _crossBrand1: StepName = _validTask;

// @ts-expect-error — Type 'Branded<string, "StepName">' is not assignable to type 'TaskName'
const _crossBrand2: TaskName = _validStep;

// ── Discriminated union exhaustiveness ──────────────────────────

// Verify that GuardError and TaskError are structurally distinct.
const _guardErr: GuardError = {
  _tag: "GuardError",
  task: "test" as TaskName,
  guard: "nonEmpty",
  message: "fail",
  context: null,
};

const _taskErr: TaskError = {
  _tag: "TaskError",
  task: "test" as TaskName,
  message: "fail",
  cause: null,
};

// The switch exhaustiveness check from the runtime test compiles.
function handle(err: GuardError | TaskError): string {
  switch (err._tag) {
    case "GuardError":
      return `Guard failed on ${err.task}: ${err.message}`;
    case "TaskError":
      return `Task failed on ${err.task}: ${err.message}`;
    default: {
      const _ensure: never = err;
      return _ensure;
    }
  }
}

// Calling handle with each variant compiles.
handle(_guardErr);
handle(_taskErr);

// ── CycleError shape ────────────────────────────────────────────

const _cycleErr: CycleError = {
  _tag: "CycleError",
  cycle: ["a" as TaskName, "b" as TaskName, "a" as TaskName],
  message: "a → b → a",
};

// Verify the _tag discriminator is present.
const _cycleTag: "CycleError" = _cycleErr._tag;
void (_cycleTag);
