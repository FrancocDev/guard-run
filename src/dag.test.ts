import { describe, it, expect } from "bun:test";
import { isString, isNumber } from "@francocdev/ts-patterns/guards";
import { success, failure, type Result } from "@francocdev/ts-patterns/result";
import type { Guard } from "@francocdev/ts-patterns/guards";
import { validateDAG, executeSequential } from "./dag.js";
import { task } from "./task.js";
import type { GuardRunError, TaskDef, TaskName, GuardError, TaskError } from "./types.js";

// ── Helpers ────────────────────────────────────────────────────

/** Guard that always passes. */
const always =
  <T>(): Guard<T> =>
  (_x: unknown): _x is T =>
    true;

/** Guard that always fails. */
const never =
  <T>(): Guard<T> =>
  (_x: unknown): _x is T =>
    false;

/** Create a simple task with a given name, optional deps, and an identity run function. */
function makeTask(name: string, deps: string[] = []): TaskDef<string> {
  return task<string>(name as TaskName)
    .dependsOn(...(deps as TaskName[]))
    .run((ctx) => ctx)
    .build();
}

/** Convenience: unwrap a TaskDef Map from an array, keyed by task name. */
function toTaskMap<T>(tasks: TaskDef<T>[]): Map<TaskName, TaskDef<T>> {
  const map = new Map<TaskName, TaskDef<T>>();
  for (const t of tasks) {
    map.set(t.name, t);
  }
  return map;
}

/** Assert that a Result is a Success and return its value. */
function expectSuccess<T>(r: Result<T, unknown>): T {
  expect(r._tag).toBe("success");
  if (r._tag === "success") return r.value;
  throw new Error("Expected success");
}

/** Assert that a Result is a Failure and return its error. */
function expectFailure<E>(r: Result<unknown, E>): E {
  expect(r._tag).toBe("failure");
  if (r._tag === "failure") return r.error;
  throw new Error("Expected failure");
}

// ── validateDAG ────────────────────────────────────────────────

describe("validateDAG", () => {
  // ── Linear DAG: A → B → C ────────────────────────────────────

  it("sorts a linear DAG: A → B → C", () => {
    const a = makeTask("a");
    const b = makeTask("b", ["a"]);
    const c = makeTask("c", ["b"]);

    const result = validateDAG([c, b, a]); // deliberately shuffled
    const order = expectSuccess(result);

    // a must come before b, b before c
    expect(order.indexOf("a" as TaskName)).toBeLessThan(order.indexOf("b" as TaskName));
    expect(order.indexOf("b" as TaskName)).toBeLessThan(order.indexOf("c" as TaskName));
    expect(order).toHaveLength(3);
  });

  // ── Diamond DAG: A → B, A → C, B → D, C → D ─────────────────

  it("sorts a diamond DAG", () => {
    const a = makeTask("a");
    const b = makeTask("b", ["a"]);
    const c = makeTask("c", ["a"]);
    const d = makeTask("d", ["b", "c"]);

    const result = validateDAG([b, a, d, c]);
    const order = expectSuccess(result);

    // Constraints
    expect(order.indexOf("a" as TaskName)).toBeLessThan(order.indexOf("b" as TaskName));
    expect(order.indexOf("a" as TaskName)).toBeLessThan(order.indexOf("c" as TaskName));
    expect(order.indexOf("b" as TaskName)).toBeLessThan(order.indexOf("d" as TaskName));
    expect(order.indexOf("c" as TaskName)).toBeLessThan(order.indexOf("d" as TaskName));
    expect(order).toHaveLength(4);
  });

  // ── Cycle detection: A → B → A ───────────────────────────────

  it("detects a direct cycle: A → B → A", () => {
    const a = makeTask("a", ["b"]);
    const b = makeTask("b", ["a"]);

    const result = validateDAG([a, b]);
    const err = expectFailure(result);

    expect(err._tag).toBe("CycleError");
    expect(err.message).toMatch(/cycle/i);
    // Should mention both nodes
    expect(err.cycle.length).toBeGreaterThanOrEqual(2);
  });

  it("detects a self-loop: A → A", () => {
    const a = makeTask("a", ["a"]);

    const result = validateDAG([a]);
    const err = expectFailure(result);

    expect(err._tag).toBe("CycleError");
    expect(err.cycle).toContain("a" as TaskName);
  });

  // ── Single task (no dependencies) ────────────────────────────

  it("handles a single task with no dependencies", () => {
    const a = makeTask("a");
    const result = validateDAG([a]);
    const order = expectSuccess(result);
    expect(order).toEqual(["a" as TaskName]);
  });

  // ── Disconnected tasks (no edges at all) ────────────────────

  it("handles multiple disconnected tasks", () => {
    const a = makeTask("a");
    const b = makeTask("b");
    const c = makeTask("c");
    const result = validateDAG([c, a, b]);
    const order = expectSuccess(result);
    expect(order).toHaveLength(3);
    expect(order).toContain("a" as TaskName);
    expect(order).toContain("b" as TaskName);
    expect(order).toContain("c" as TaskName);
  });

  // ── Empty tasks array ────────────────────────────────────────

  it("returns empty order for no tasks", () => {
    const result = validateDAG([]);
    const order = expectSuccess(result);
    expect(order).toEqual([]);
  });
});

// ── executeSequential ──────────────────────────────────────────

describe("executeSequential", () => {
  // ── Linear DAG execution ─────────────────────────────────────

  it("executes tasks in the given order", () => {
    const a = makeTask("a");
    const b = makeTask("b", ["a"]);
    const c = makeTask("c", ["b"]);

    const dag = validateDAG([a, b, c]);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap([a, b, c]), order, "");
    expectSuccess(result);
  });

  // ── Context threading ────────────────────────────────────────

  it("threads context through tasks that modify it", () => {
    const tasks = [
      task<string>("a" as TaskName).run(() => "step_a").build(),
      task<string>("b" as TaskName)
        .dependsOn("a" as TaskName)
        .run((ctx) => ctx + ":step_b")
        .build(),
    ];

    const dag = validateDAG(tasks);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap(tasks), order, "start");
    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value).toBe("step_a:step_b");
    }
  });

  // ── Pre-guard fail → short-circuit ───────────────────────────

  it("short-circuits when a pre-guard fails", () => {
    const a = task<string>("a" as TaskName)
      .pre(never<string>())
      .run(() => "a-ran")
      .build();
    const b = makeTask("b", ["a"]);

    const dag = validateDAG([a, b]);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap([a, b]), order, "start");
    const err = expectFailure(result);

    expect(err._tag).toBe("GuardError");
    expect((err as GuardError).task).toBe("a" as TaskName);
  });

  // ── Post-guard fail after run → task marked failed ───────────

  it("fails when a post-guard fails after the task ran", () => {
    const a = task<string>("a" as TaskName)
      .post(never<string>())
      .run(() => "a-ran")
      .build();

    const dag = validateDAG([a]);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap([a]), order, "");
    const err = expectFailure(result);

    expect(err._tag).toBe("GuardError");
  });

  // ── Post-guard fail → downstream skipped ─────────────────────

  it("skips downstream when post-guard fails", () => {
    let bRan = false;
    const a = task<string>("a" as TaskName)
      .post(never<string>())
      .run(() => "a-ran")
      .build();
    const b = task<string>("b" as TaskName)
      .dependsOn("a" as TaskName)
      .run(() => {
        bRan = true;
        return "b-ran";
      })
      .build();

    const dag = validateDAG([a, b]);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap([a, b]), order, "");
    expectFailure(result);
    expect(bRan).toBe(false);
  });

  // ── Task body throws → downstream skipped ────────────────────

  it("short-circuits when a task body throws", () => {
    let bRan = false;
    const a = task<string>("a" as TaskName)
      .run((): string => {
        throw new Error("explosion");
      })
      .build();
    const b = task<string>("b" as TaskName)
      .dependsOn("a" as TaskName)
      .run(() => {
        bRan = true;
        return "b-ran";
      })
      .build();

    const dag = validateDAG([a, b]);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap([a, b]), order, "");
    const err = expectFailure(result);

    expect(err._tag).toBe("TaskError");
    expect((err as TaskError).message).toMatch(/explosion/);
    expect(bRan).toBe(false);
  });

  // ── Pre-guard passes → task runs normally ───────────────────

  it("runs normally when all guards pass", () => {
    const a = task<string>("a" as TaskName)
      .pre(always<string>())
      .post(always<string>())
      .run(() => "a-complete")
      .build();

    const dag = validateDAG([a]);
    const order = expectSuccess(dag);

    const result = executeSequential(toTaskMap([a]), order, "");
    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value).toBe("a-complete");
    }
  });

  // ── Topological order correctness via execution side-effects ─

  it("executes in correct topological order (linear)", () => {
    const execOrder: string[] = [];

    const a = task<string>("a" as TaskName)
      .run(() => {
        execOrder.push("a");
        return "ok";
      })
      .build();
    const b = task<string>("b" as TaskName)
      .dependsOn("a" as TaskName)
      .run(() => {
        execOrder.push("b");
        return "ok";
      })
      .build();
    const c = task<string>("c" as TaskName)
      .dependsOn("b" as TaskName)
      .run(() => {
        execOrder.push("c");
        return "ok";
      })
      .build();

    const dag = validateDAG([a, b, c]);
    const order = expectSuccess(dag);

    executeSequential(toTaskMap([a, b, c]), order, "");
    expect(execOrder).toEqual(["a", "b", "c"]);
  });

  // ── Multiple pre/post guards in order ────────────────────────

  it("runs pre-guards and post-guards in registration order", () => {
    const callOrder: string[] = [];

    const guard1: Guard<string> = (x: unknown): x is string => {
      callOrder.push("pre1");
      return true;
    };
    const guard2: Guard<string> = (x: unknown): x is string => {
      callOrder.push("pre2");
      return true;
    };
    const guard3: Guard<string> = (x: unknown): x is string => {
      callOrder.push("post1");
      return true;
    };
    const guard4: Guard<string> = (x: unknown): x is string => {
      callOrder.push("post2");
      return true;
    };

    const a = task<string>("a" as TaskName)
      .pre(guard1)
      .pre(guard2)
      .run(() => {
        callOrder.push("run");
        return "ok";
      })
      .post(guard3)
      .post(guard4)
      .build();

    const dag = validateDAG([a]);
    const order = expectSuccess(dag);

    executeSequential(toTaskMap([a]), order, "");
    expect(callOrder).toEqual(["pre1", "pre2", "run", "post1", "post2"]);
  });
});
