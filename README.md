# guard-run

CLI task runner where each task declares **pre/post conditions** as type predicates (guards). Tasks form a **DAG** — the runner validates no cycles, executes in topological order, and **short-circuits** on guard failure.

Built with [Bun](https://bun.sh) — zero runtime deps beyond `@francocdev/ts-patterns`.

## Install

```sh
bun add @francocdev/guard-run
```

## Quick Start

### 1. Create a config file

`guard-run.config.ts`:

```ts
import { task } from "@francocdev/guard-run";
import { isString, isNumber } from "@francocdev/ts-patterns/guards";

// ── Define tasks with guards ─────────────────────────────────

const lint = task("lint")
  .pre(isString)                    // pre-condition: input must be string
  .run((ctx) => {
    console.log("linting:", ctx);
    return ctx;
  })
  .post(isString)                   // post-condition: output must be string
  .build();

const build = task("build")
  .dependsOn("lint")                // lint must pass before build runs
  .pre(isString)
  .run((ctx) => {
    console.log("building:", ctx);
    return ctx;
  })
  .build();

const test = task("test")
  .dependsOn("build")               // build must pass before test runs
  .run((ctx) => {
    console.log("testing:", ctx);
    return ctx;
  })
  .build();

// ── Export tasks ─────────────────────────────────────────────

export const tasks = [lint, build, test];
```

### 2. Run it

```sh
bunx guard-run guard-run.config.ts
```

Output:

```
  PASS  lint
  PASS  build
  PASS  test
```

If a guard fails:

```
  FAIL  lint
  SKIPPED  build
  SKIPPED  test
```

## API Reference

### `task<T>(name): TaskBuilder<T>`

Create a new task builder. The generic `T` is usually inferred from guards and the run function. Use the explicit `task<MyType>(name)` form when you have 5+ guards (bypasses TypeScript's compositional inference limit).

| Method | Signature | Description |
|--------|-----------|-------------|
| `.pre(...guards)` | `(...Guard<T>[]) => TaskBuilder<T>` | Add pre-condition guards (run before the task body) |
| `.post(...guards)` | `(...Guard<T>[]) => TaskBuilder<T>` | Add post-condition guards (run on the task result) |
| `.dependsOn(...names)` | `(...TaskName[]) => TaskBuilder<T>` | Declare dependencies — predecessors that must pass first |
| `.run(fn)` | `((ctx: T) => T) => TaskBuilder<T>` | Define the executable body (receives threaded context) |
| `.build()` | `() => TaskDef<T>` | Produce the final task descriptor |

### `TaskDef<T>`

The descriptor produced by `.build()`. Pass an array of these to the DAG engine.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `TaskName` | Branded task identifier |
| `pre` | `Guard<T>[]` | Pre-condition guards |
| `run` | `(ctx: T) => Result<T, GuardRunError>` | Executable body |
| `post` | `Guard<T>[]` | Post-condition guards |
| `dependencies` | `TaskName[]` | Required predecessors |

### `validateDAG(tasks): Result<TaskName[], CycleError>`

Validate the task DAG using Kahn's algorithm. Returns tasks in topological order, or a `CycleError` if the graph contains a cycle.

### `executeSequential(tasks, order, initial): Result<T, GuardRunError>`

Execute tasks sequentially in the given topological order. For each task: (1) run pre-guards, (2) run body, (3) run post-guards. Context (`ctx`) threads through successful tasks. Any failure short-circuits remaining tasks.

## CLI

```sh
guard-run [config-file]
```

Defaults to `./guard-run.config.ts` if no argument is given.

| Exit code | Meaning |
|-----------|---------|
| `0` | All tasks passed |
| `1` | One or more tasks failed |

Output uses colored ANSI: **green** PASS, **red** FAIL, **yellow** SKIPPED.

## DAG Execution

Tasks execute in dependency-respecting topological order:

1. **Pre-guards** — run in registration order; first failure short-circuits the task
2. **Task body** — executes if all pre-guards pass
3. **Post-guards** — run on the result; first failure marks the task as failed

When any task fails, all remaining tasks are **skipped** (short-circuit).

## License

MIT
