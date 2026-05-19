import { success, failure } from "@francocdev/ts-patterns/result";
import type { Result } from "@francocdev/ts-patterns/result";
import type { CycleError, GuardError, GuardRunError, TaskDef, TaskName } from "./types.js";

// ── Topological sort (Kahn's algorithm) ────────────────────────

/**
 * Validate a task DAG using Kahn's algorithm.
 *
 * Returns the tasks in dependency-respecting topological order, or a
 * `CycleError` if the graph contains a cycle.
 *
 * @param tasks — Array of task descriptors (from `task(...).build()`)
 * @returns `Success<TaskName[]>` with the execution order, or `Failure<CycleError>`
 *
 * @example
 * ```ts
 * const result = validateDAG([aDef, bDef, cDef])
 * if (result._tag === "success") {
 *   // result.value = ["a", "b", "c"] (topologically sorted)
 * }
 * ```
 */
export function validateDAG<T = unknown>(tasks: TaskDef<T>[]): Result<TaskName[], CycleError> {
  // ── Build graph structures ──────────────────────────────────
  const inDegree = new Map<TaskName, number>();
  const adjacency = new Map<TaskName, TaskName[]>();
  const taskNames = new Set<TaskName>();

  for (const t of tasks) {
    taskNames.add(t.name);
    inDegree.set(t.name, 0);
    adjacency.set(t.name, []);
  }

  for (const t of tasks) {
    for (const dep of t.dependencies) {
      // Only consider edges between tasks we know about
      if (taskNames.has(dep)) {
        adjacency.get(dep)!.push(t.name);
        inDegree.set(t.name, (inDegree.get(t.name) ?? 0) + 1);
      }
      // External dependencies (not in our task set) are ignored
    }
  }

  // ── Kahn's algorithm ────────────────────────────────────────
  const queue: TaskName[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) {
      queue.push(name);
    }
  }

  const sorted: TaskName[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const current = inDegree.get(neighbor) ?? 1;
      const next = current - 1;
      inDegree.set(neighbor, next);
      if (next === 0) {
        queue.push(neighbor);
      }
    }
  }

  // ── Cycle detection ─────────────────────────────────────────
  if (sorted.length < taskNames.size) {
    const cyclePath = findCycle(adjacency, taskNames, sorted);
    const pathStr = cyclePath.join(" → ");
    return failure({
      _tag: "CycleError",
      cycle: cyclePath,
      message: `Cycle detected: ${pathStr}`,
    } satisfies CycleError);
  }

  return success(sorted);
}

/**
 * Find a cycle path from the remaining unsorted nodes after Kahn's
 * algorithm detects a cycle.
 */
function findCycle(
  adjacency: Map<TaskName, TaskName[]>,
  allNames: Set<TaskName>,
  sorted: TaskName[],
): TaskName[] {
  // Determine which nodes are still in the cycle (not sorted)
  const remaining = new Set(allNames);
  for (const n of sorted) remaining.delete(n);

  if (remaining.size === 0) return [];

  // DFS from any remaining node to find the cycle
  const start = remaining.values().next().value!;
  const visited = new Set<TaskName>();
  const path: TaskName[] = [];

  function dfs(node: TaskName): TaskName[] | null {
    if (visited.has(node)) {
      const idx = path.indexOf(node);
      if (idx !== -1) {
        // Found a cycle — return from cycle start, close the loop
        return [...path.slice(idx), node];
      }
      return null;
    }
    if (!remaining.has(node)) return null;

    visited.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const result = dfs(neighbor);
      if (result) return result;
    }

    path.pop();
    return null;
  }

  return dfs(start) ?? [...remaining];
}

// ── Sequential execution ───────────────────────────────────────

/**
 * Execute tasks sequentially in the given topological order.
 *
 * For each task (in order):
 * 1. Run **pre-guards** — first failure short-circuits with `Failure<GuardError>`
 * 2. Run the **task body** — failure produces `Failure<TaskError>`
 * 3. Run **post-guards** — first failure short-circuits with `Failure<GuardError>`
 *
 * When a task fails, all remaining tasks are **skipped** (short-circuit).
 * The context (`ctx`) is threaded through each successful task.
 *
 * @param tasks — Map of task name → TaskDef
 * @param order — Topological sort order from `validateDAG`
 * @param initial — Initial context value passed to the first task
 * @returns `Success<T>` with the final context, or `Failure<GuardRunError>`
 *
 * @example
 * ```ts
 * const dag = validateDAG([...])
 * if (dag._tag === "success") {
 *   const result = executeSequential(taskMap, dag.value, initialState)
 * }
 * ```
 */
export function executeSequential<T>(
  tasks: Map<TaskName, TaskDef<T>>,
  order: TaskName[],
  initial: T,
): Result<T, GuardRunError> {
  let ctx: T = initial;

  for (const name of order) {
    const taskDef = tasks.get(name) as TaskDef<T> | undefined;
    if (!taskDef) continue;

    // Step 1: Pre-guards
    for (const guard of taskDef.pre) {
      if (!guard(ctx)) {
        return failure<GuardRunError>({
          _tag: "GuardError",
          task: name,
          guard: guard.name || "pre-guard",
          message: `Pre-guard failed for task "${name}"`,
          context: ctx,
        });
      }
    }

    // Step 2: Run the task body
    const runResult = taskDef.run(ctx);
    if (runResult._tag === "failure") {
      return runResult;
    }
    ctx = runResult.value;

    // Step 3: Post-guards
    for (const guard of taskDef.post) {
      if (!guard(ctx)) {
        return failure<GuardRunError>({
          _tag: "GuardError",
          task: name,
          guard: guard.name || "post-guard",
          message: `Post-guard failed for task "${name}"`,
          context: ctx,
        });
      }
    }
  }

  return success(ctx);
}
