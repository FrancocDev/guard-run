/**
 * Integration tests for guard-run — end-to-end scenarios combining
 * the task builder, DAG engine, and guard mechanics.
 *
 * Covers:
 * - Spec 8.1: `task<T>()` escape hatch with explicit type parameter
 * - Spec 8.2: 7-guard chain (pre + post combined) validates type inference
 * - DAG execution with guards, dependencies, and short-circuit
 */
import { describe, it, expect } from "bun:test";
import { isString, isNumber } from "@francocdev/ts-patterns/guards";
import { success, failure, type Result } from "@francocdev/ts-patterns/result";
import type { Guard } from "@francocdev/ts-patterns/guards";
import { task } from "./task.js";
import { validateDAG, executeSequential } from "./dag.js";
import type { TaskDef, TaskName, GuardError, GuardRunError, TaskError } from "./types.js";

// ── Test domain type ────────────────────────────────────────────

interface PipelineContext {
  step: string;
  artifacts: string[];
  checksum: number;
}

// ── Guards (some pass, some fail depending on scenario) ─────────

const hasStep =
  (expected: string): Guard<PipelineContext> =>
  (x: unknown): x is PipelineContext =>
    typeof x === "object" && x !== null && "step" in x && (x as PipelineContext).step === expected;

const checksumPositive: Guard<PipelineContext> = (x: unknown): x is PipelineContext =>
  typeof x === "object" && x !== null && "step" in x && (x as PipelineContext).checksum > 0;

const hasArtifacts: Guard<PipelineContext> = (x: unknown): x is PipelineContext =>
  typeof x === "object" &&
  x !== null &&
  "artifacts" in x &&
  Array.isArray((x as PipelineContext).artifacts);

const always =
  <T>(): Guard<T> =>
  (_x: unknown): _x is T =>
    true;

const never =
  <T>(): Guard<T> =>
  (_x: unknown): _x is T =>
    false;

// ── Helpers ────────────────────────────────────────────────────

function toTaskMap<T>(tasks: TaskDef<T>[]): Map<TaskName, TaskDef<T>> {
  const map = new Map<TaskName, TaskDef<T>>();
  for (const t of tasks) map.set(t.name, t);
  return map;
}

function expectSuccess<T, E>(r: Result<T, E>): T {
  expect(r._tag).toBe("success");
  if (r._tag === "success") return r.value;
  throw new Error("Expected success");
}

function expectFailure<E>(r: Result<unknown, E>): E {
  expect(r._tag).toBe("failure");
  if (r._tag === "failure") return r.error;
  throw new Error("Expected failure");
}

// ── Spec 8.1: Escape hatch with explicit types ─────────────────

describe("task<T>() escape hatch — integration", () => {
  it("resolves explicit type parameter end-to-end through DAG", () => {
    // Use task<PipelineContext>() explicit type param — spec 8.1
    const init = task<PipelineContext>("init" as TaskName)
      .pre(always<PipelineContext>())
      .run(() => ({ step: "init", artifacts: [], checksum: 0 }))
      .post(hasArtifacts)
      .build();

    const dag = validateDAG([init]);
    const order = expectSuccess(dag);
    expect(order).toEqual(["init" as TaskName]);

    const result = executeSequential(
      toTaskMap([init]),
      order,
      {} as PipelineContext,
    );
    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value.step).toBe("init");
      expect(result.value.artifacts).toEqual([]);
    }
  });
});

// ── Spec 8.2: 7-guard chain ────────────────────────────────────

describe("7-guard chain", () => {
  it("handles 7 guards total (pre + post combined) via task<T>() escape hatch", () => {
    // 4 pre-guards + 3 post-guards = 7 guards total
    const g = always<PipelineContext>();

    const pipeline = task<PipelineContext>("pipeline" as TaskName)
      .pre(g, g, g, g)       // 4 pre-guards
      .run((ctx) => ({
        ...ctx,
        step: "complete",
        artifacts: [...ctx.artifacts, "output"],
        checksum: ctx.checksum + 1,
      }))
      .post(g, g, g)          // 3 post-guards = 7 total
      .build();

    // Validate the task was built correctly
    expect(pipeline.pre).toHaveLength(4);
    expect(pipeline.post).toHaveLength(3);

    // Execute via DAG
    const dag = validateDAG<PipelineContext>([pipeline]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([pipeline]),
      order,
      { step: "start", artifacts: [], checksum: 0 } as PipelineContext,
    );
    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value.step).toBe("complete");
      expect(result.value.artifacts).toEqual(["output"]);
    }
  });

  it("7 guards spread across two chained tasks", () => {
    // Task "a": 4 pre + 1 post = 5 guards
    // Task "b": 2 post = 2 guards
    // Total: 7 guards across DAG
    const g = always<PipelineContext>();

    const a = task<PipelineContext>("a" as TaskName)
      .pre(g, g, g, g)
      .run((ctx) => ({
        ...ctx,
        step: "a-done",
        artifacts: [...ctx.artifacts, "from-a"],
        checksum: ctx.checksum + 1,
      }))
      .post(g)  // 1 post-guard
      .build();

    const b = task<PipelineContext>("b" as TaskName)
      .dependsOn("a" as TaskName)
      .run((ctx) => ({
        ...ctx,
        step: "b-done",
        artifacts: [...ctx.artifacts, "from-b"],
        checksum: ctx.checksum + 1,
      }))
      .post(g, g)  // 2 post-guards
      .build();

    const dag = validateDAG<PipelineContext>([a, b]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([a, b]),
      order,
      { step: "start", artifacts: [], checksum: 0 } as PipelineContext,
    );

    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value.step).toBe("b-done");
      expect(result.value.artifacts).toEqual(["from-a", "from-b"]);
      expect(result.value.checksum).toBe(2);
    }
  });
});

// ── DAG integration: guards + dependencies + short-circuit ─────

describe("DAG integration", () => {
  it("passes when all guards and dependencies succeed", () => {
    const validate = task<PipelineContext>("validate" as TaskName)
      .pre(checksumPositive)
      .run((ctx) => ({
        ...ctx,
        step: "validated",
        artifacts: [...ctx.artifacts, "valid"],
        checksum: ctx.checksum + 10,
      }))
      .post(hasArtifacts)
      .build();

    const build = task<PipelineContext>("build" as TaskName)
      .dependsOn("validate" as TaskName)
      .pre(hasStep("validated"))
      .run((ctx) => ({
        ...ctx,
        step: "built",
        artifacts: [...ctx.artifacts, "dist"],
        checksum: ctx.checksum + 20,
      }))
      .build();

    const dag = validateDAG<PipelineContext>([validate, build]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([validate, build]),
      order,
      { step: "init", artifacts: [], checksum: 5 } as PipelineContext,
    );

    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      // build runs after validate, context threads through
      expect(result.value.step).toBe("built");
      expect(result.value.artifacts).toContain("valid");
      expect(result.value.artifacts).toContain("dist");
      // 5 (initial) + 10 (validate) + 20 (build)
      expect(result.value.checksum).toBe(35);
    }
  });

  it("short-circuits when pre-guard fails, downstream is skipped", () => {
    let downstreamRan = false;

    const failing = task<PipelineContext>("gate" as TaskName)
      .pre(never<PipelineContext>())  // always fails
      .run((ctx) => ({
        ...ctx,
        step: "gate-passed",
        artifacts: [...ctx.artifacts, "should-not-reach"],
        checksum: ctx.checksum + 1,
      }))
      .build();

    const downstream = task<PipelineContext>("downstream" as TaskName)
      .dependsOn("gate" as TaskName)
      .run((ctx) => {
        downstreamRan = true;
        return {
          ...ctx,
          step: "downstream-ran",
          artifacts: [...ctx.artifacts, "should-not-reach"],
          checksum: ctx.checksum + 1,
        };
      })
      .build();

    const dag = validateDAG<PipelineContext>([failing, downstream]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([failing, downstream]),
      order,
      { step: "start", artifacts: [], checksum: 1 } as PipelineContext,
    );

    const err = expectFailure(result);
    expect(err._tag).toBe("GuardError");
    expect((err as GuardError).task).toBe("gate" as TaskName);
    expect(downstreamRan).toBe(false);
  });

  it("short-circuits when post-guard fails after task runs", () => {
    const failAfterRun = task<PipelineContext>("builder" as TaskName)
      .run((ctx) => ({
        ...ctx,
        step: "built",
        artifacts: [...ctx.artifacts, "artifact"],
        checksum: ctx.checksum + 1,
      }))
      .post(never<PipelineContext>())  // fails after run succeeds
      .build();

    const dag = validateDAG<PipelineContext>([failAfterRun]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([failAfterRun]),
      order,
      { step: "start", artifacts: [], checksum: 0 } as PipelineContext,
    );

    const err = expectFailure(result);
    expect(err._tag).toBe("GuardError");
  });

  it("short-circuits when task body throws", () => {
    const throwing = task<PipelineContext>("thrower" as TaskName)
      .run((): PipelineContext => {
        throw new Error("runtime failure");
      })
      .build();

    const dependent = task<PipelineContext>("dependent" as TaskName)
      .dependsOn("thrower" as TaskName)
      .run((ctx) => ctx)
      .build();

    const dag = validateDAG<PipelineContext>([throwing, dependent]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([throwing, dependent]),
      order,
      { step: "start", artifacts: [], checksum: 0 } as PipelineContext,
    );

    const err = expectFailure(result);
    expect(err._tag).toBe("TaskError");
    expect((err as TaskError).message).toMatch(/runtime failure/);
  });

  it("executes in correct topological order with guards", () => {
    const execOrder: string[] = [];
    const g = always<PipelineContext>();

    const a = task<PipelineContext>("a" as TaskName)
      .pre(g)
      .run((ctx) => {
        execOrder.push("a");
        return { ...ctx, step: "a", checksum: 1 };
      })
      .build();

    const b = task<PipelineContext>("b" as TaskName)
      .dependsOn("a" as TaskName)
      .run((ctx) => {
        execOrder.push("b");
        return { ...ctx, step: "b", checksum: 2 };
      })
      .build();

    const c = task<PipelineContext>("c" as TaskName)
      .dependsOn("b" as TaskName)
      .post(g)
      .run((ctx) => {
        execOrder.push("c");
        return { ...ctx, step: "c", checksum: 3 };
      })
      .build();

    const dag = validateDAG<PipelineContext>([a, b, c]);
    const order = expectSuccess(dag);

    executeSequential(
      toTaskMap([a, b, c]),
      order,
      { step: "init", artifacts: [], checksum: 0 } as PipelineContext,
    );

    expect(execOrder).toEqual(["a", "b", "c"]);
  });
});

// ── Type-level test: compile-time validation ───────────────────

describe("type-level compile checks", () => {
  it("task<T>() produces correct type through inference", () => {
    // This is a runtime test that validates the compile-time types
    // by exercising the full pipeline end-to-end.
    const g = always<PipelineContext>();
    const t = task<PipelineContext>("type-check" as TaskName)
      .pre(g, g)
      .run((ctx) => ctx)
      .post(g, g, g)  // 2 + 3 = 5 guards total with explicit type param
      .build();

    const dag = validateDAG<PipelineContext>([t]);
    const order = expectSuccess(dag);

    const result = executeSequential(
      toTaskMap([t]),
      order,
      { step: "start", artifacts: [], checksum: 0 } as PipelineContext,
    );

    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value.step).toBe("start");
    }
  });
});
