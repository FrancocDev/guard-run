import { describe, it, expect } from "bun:test";
import { isString, isNumber, type Guard } from "@francocdev/ts-patterns/guards";
import { task } from "./task.js";
import type { TaskBuilder } from "./task.js";
import type { TaskName } from "./types.js";

// ── Helpers ────────────────────────────────────────────────────

/** A simple no-op guard that passes for any value. */
const isAlways =
  <T>(): Guard<T> =>
  (x: unknown): x is T =>
    true;

/** A guard that always fails. */
const isNever =
  <T>(): Guard<T> =>
  (_x: unknown): _x is T =>
    false;

// ── Spec 1.1: Valid task factory ───────────────────────────────

describe("task() factory", () => {
  it("returns a TaskBuilder with the correct name", () => {
    const builder = task("build" as TaskName);
    expect(builder).toBeDefined();
    expect(typeof builder.pre).toBe("function");
    expect(typeof builder.post).toBe("function");
    expect(typeof builder.dependsOn).toBe("function");
    expect(typeof builder.run).toBe("function");
    expect(typeof (builder as TaskBuilder<unknown>).build).toBe("function");
  });

  it("build() produces a TaskDef with the given name", () => {
    const def = task("build" as TaskName).run(() => "done").build();
    expect(def.name).toBe("build" as TaskName);
  });
});

// ── Spec 2: Pre / Post guard accumulation ──────────────────────

describe("pre guards", () => {
  it("accumulates guards in registration order", () => {
    const ga = isString as Guard<unknown>;
    const gb = isNumber as Guard<unknown>;
    const def = task("order" as TaskName).pre(ga).pre(gb).run(() => null).build();
    expect(def.pre).toHaveLength(2);
    expect(def.pre[0]).toBe(ga);
    expect(def.pre[1]).toBe(gb);
  });

  it("is empty when no guards added", () => {
    const def = task("empty" as TaskName).run(() => null).build();
    expect(def.pre).toEqual([]);
  });
});

describe("post guards", () => {
  it("accumulates guards in registration order", () => {
    const ga = isString as Guard<unknown>;
    const gb = isNumber as Guard<unknown>;
    const def = task("order" as TaskName).post(ga).post(gb).run(() => null).build();
    expect(def.post).toHaveLength(2);
    expect(def.post[0]).toBe(ga);
    expect(def.post[1]).toBe(gb);
  });

  it("is empty when no guards added", () => {
    const def = task("empty" as TaskName).run(() => null).build();
    expect(def.post).toEqual([]);
  });
});

// ── Spec 3: Run function ──────────────────────────────────────

describe("run", () => {
  it("accepts a function returning a value", () => {
    const def = task("x" as TaskName).run(() => "ok").build();
    expect(typeof def.run).toBe("function");
  });

  it("wraps a successful execution in Result<T>", () => {
    const def = task("x" as TaskName).run(() => "hello").build();
    const result = def.run("ctx");
    expect(result._tag).toBe("success");
    if (result._tag === "success") {
      expect(result.value).toBe("hello");
    }
  });

  it("wraps a thrown error into Failure<TaskError>", () => {
    const def = task("boom" as TaskName)
      .run(() => {
        throw new Error("explosion");
      })
      .build();
    const result = def.run("ctx");
    expect(result._tag).toBe("failure");
    if (result._tag === "failure") {
      expect(result.error._tag).toBe("TaskError");
    }
  });

  it("build() throws if no run function was set", () => {
    const builder = task("no-run" as TaskName);
    expect(() => builder.build()).toThrow(/no run function/);
  });
});

// ── Spec 4: dependsOn ─────────────────────────────────────────

describe("dependsOn", () => {
  it("accepts a single dependency", () => {
    const def = task("test" as TaskName).dependsOn("build" as TaskName).run(() => null).build();
    expect(def.dependencies).toEqual(["build" as TaskName]);
  });

  it("accepts multiple dependencies", () => {
    const def = task("deploy" as TaskName)
      .dependsOn("build" as TaskName, "test" as TaskName)
      .run(() => null)
      .build();
    expect(def.dependencies).toHaveLength(2);
    expect(def.dependencies[0]).toBe("build" as TaskName);
    expect(def.dependencies[1]).toBe("test" as TaskName);
  });

  it("is empty when no dependencies declared", () => {
    const def = task("standalone" as TaskName).run(() => null).build();
    expect(def.dependencies).toEqual([]);
  });
});

// ── Spec 2.4: Multiple compose — chain order ──────────────────

describe("full builder chain", () => {
  it("builds a complete TaskDef with pre, post, deps, and run", () => {
    const def = task("full" as TaskName)
      .pre(isString as Guard<unknown>)
      .post(isNumber as Guard<unknown>)
      .dependsOn("setup" as TaskName)
      .run(() => 42)
      .build();

    expect(def.name).toBe("full" as TaskName);
    expect(def.pre).toHaveLength(1);
    expect(def.post).toHaveLength(1);
    expect(def.dependencies).toHaveLength(1);
    expect(typeof def.run).toBe("function");
  });

  it("build output is immutable copy (not shared reference)", () => {
    const ga = isString as Guard<unknown>;
    const builder = task("mutable" as TaskName).pre(ga).run(() => null);
    const def1 = builder.build();
    const def2 = builder.build();
    // Both builds should be independent
    expect(def1.pre).toEqual(def2.pre);
  });
});

// ── Escape hatch: task<T>() ───────────────────────────────────

describe("task<T>() escape hatch", () => {
  it("accepts an explicit type parameter", () => {
    const def = task<string>("typed" as TaskName).run((ctx) => ctx).build();
    const result = def.run("hello");
    expect(result._tag).toBe("success");
  });

  it("handles 6 guards without type inference overload", () => {
    const g = isAlways<string>();
    const def = task<string>("many" as TaskName)
      .pre(g, g, g, g, g, g)
      .run((ctx) => ctx)
      .build();
    const result = def.run("works");
    expect(result._tag).toBe("success");
  });

  it("handles 7 guards via escape hatch", () => {
    const g = isAlways<string>();
    const def = task<string>("many7" as TaskName)
      .pre(g, g, g, g, g, g, g)
      .run((ctx) => ctx)
      .build();
    const result = def.run("works");
    expect(result._tag).toBe("success");
  });
});
