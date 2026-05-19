import { describe, it, expect } from "bun:test";
import { success } from "@francocdev/ts-patterns/result";
import type { CycleError, GuardError, TaskDef, TaskError, TaskName } from "./types.js";

// ── Runtime shape tests ────────────────────────────────────────

describe("TaskDef", () => {
  it("holds the expected shape", () => {
    const def: TaskDef = {
      name: "build" as TaskName,
      pre: [],
      run: () => success("ok"),
      post: [],
      dependencies: [],
    };
    expect(def.name).toBe("build" as TaskName);
    expect(def.pre).toEqual([]);
    expect(typeof def.run).toBe("function");
    expect(def.post).toEqual([]);
    expect(def.dependencies).toEqual([]);
  });
});

describe("GuardError", () => {
  it("is discriminated with _tag 'GuardError'", () => {
    const err: GuardError = {
      _tag: "GuardError",
      task: "lint" as TaskName,
      guard: "nonEmpty",
      message: "Value is empty",
      context: "",
    };
    expect(err._tag).toBe("GuardError");
    expect(err.task).toBe("lint" as TaskName);
    expect(err.message).toBe("Value is empty");
  });
});

describe("TaskError", () => {
  it("is discriminated with _tag 'TaskError'", () => {
    const err: TaskError = {
      _tag: "TaskError",
      task: "build" as TaskName,
      message: "Build failed",
      cause: new Error("compilation error"),
    };
    expect(err._tag).toBe("TaskError");
    expect(err.message).toBe("Build failed");
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe("CycleError", () => {
  it("is discriminated with _tag 'CycleError'", () => {
    const err: CycleError = {
      _tag: "CycleError",
      cycle: ["a" as TaskName, "b" as TaskName, "a" as TaskName],
      message: "a → b → a",
    };
    expect(err._tag).toBe("CycleError");
    expect(err.cycle).toHaveLength(3);
    expect(err.message).toBe("a → b → a");
  });
});

// ── Discriminated union exhaustiveness match ───────────────────

describe("GuardRunError (GuardError | TaskError)", () => {
  it("exhaustively matches on _tag", () => {
    const errors: Array<GuardError | TaskError> = [
      {
        _tag: "GuardError",
        task: "lint" as TaskName,
        guard: "nonEmpty",
        message: "",
        context: null,
      },
      {
        _tag: "TaskError",
        task: "build" as TaskName,
        message: "fail",
        cause: null,
      },
    ];

    for (const err of errors) {
      switch (err._tag) {
        case "GuardError":
          expect(err.guard).toBeDefined();
          break;
        case "TaskError":
          expect(err.cause).toBeDefined();
          break;
        default: {
          // Exhaustiveness check at compile time
          const _exhaustive: never = err;
          throw new Error(`Unhandled error: ${_exhaustive}`);
        }
      }
    }
  });
});
