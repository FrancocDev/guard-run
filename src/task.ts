import type { Guard } from "@francocdev/ts-patterns/guards";
import { success, failure } from "@francocdev/ts-patterns/result";
import type { Result } from "@francocdev/ts-patterns/result";
import type { GuardRunError, TaskDef, TaskName, TaskError } from "./types.js";

// ── Builder interface ──────────────────────────────────────────

export interface TaskBuilder<T> {
  /** Add one or more pre-condition guards (executed before the task body). */
  pre(...guards: Guard<T>[]): TaskBuilder<T>;

  /** Add one or more post-condition guards (executed on the task result). */
  post(...guards: Guard<T>[]): TaskBuilder<T>;

  /** Declare task dependencies — predecessors that must complete first. */
  dependsOn(...taskNames: TaskName[]): TaskBuilder<T>;

  /** Define the executable body of the task. */
  run(fn: (ctx: T) => T): TaskBuilder<T>;

  /** Produce the final `TaskDef` descriptor. */
  build(): TaskDef<T>;
}

// ── Builder implementation ─────────────────────────────────────

class TaskBuilderImpl<T> implements TaskBuilder<T> {
  readonly #name: TaskName;
  readonly #pre: Guard<T>[] = [];
  readonly #post: Guard<T>[] = [];
  readonly #deps: TaskName[] = [];
  #runFn: ((ctx: T) => T) | null = null;

  constructor(name: TaskName) {
    this.#name = name;
  }

  pre(...guards: Guard<T>[]): TaskBuilder<T> {
    this.#pre.push(...guards);
    return this;
  }

  post(...guards: Guard<T>[]): TaskBuilder<T> {
    this.#post.push(...guards);
    return this;
  }

  dependsOn(...taskNames: TaskName[]): TaskBuilder<T> {
    this.#deps.push(...taskNames);
    return this;
  }

  run(fn: (ctx: T) => T): TaskBuilder<T> {
    this.#runFn = fn;
    return this;
  }

  build(): TaskDef<T> {
    const name = this.#name;
    const runFn = this.#runFn;

    if (runFn === null) {
      throw new Error(`Task "${name}" has no run function defined`);
    }

    return {
      name,
      pre: [...this.#pre],
      run: (ctx: T): Result<T, GuardRunError> => {
        try {
          return success(runFn(ctx));
        } catch (e) {
          const err: TaskError = {
            _tag: "TaskError",
            task: name,
            message: e instanceof Error ? e.message : String(e),
            cause: e,
          };
          return failure(err);
        }
      },
      post: [...this.#post],
      dependencies: [...this.#deps],
    } satisfies TaskDef<T>;
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Create a new task builder.
 *
 * The generic parameter `T` is inferred from guards and run function.
 * Use the explicit `task<T>(name)` form when you have 5+ guards to
 * bypass TypeScript's compositional inference limit.
 *
 * @param name — The task name (must be a `TaskName` branded string)
 * @returns A `TaskBuilder<T>` for chaining `.pre()`, `.post()`, `.dependsOn()`, `.run()`
 *
 * @example
 * ```ts
 * const build = task("build" as TaskName)
 *   .pre(isString)
 *   .run((ctx) => ctx)
 *   .post(isString)
 *   .build()
 * ```
 */
export function task<T = unknown>(name: string): TaskBuilder<T> {
  return new TaskBuilderImpl<T>(name as TaskName);
}
