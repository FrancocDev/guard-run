#!/usr/bin/env bun

import { resolve } from "node:path";
import { validateDAG } from "./dag.js";
import type { TaskDef, TaskName } from "./types.js";

// ── ANSI color helpers ─────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function colored(status: "PASS" | "FAIL" | "SKIPPED"): string {
  switch (status) {
    case "PASS":
      return `${GREEN}PASS${RESET}`;
    case "FAIL":
      return `${RED}FAIL${RESET}`;
    case "SKIPPED":
      return `${YELLOW}SKIPPED${RESET}`;
  }
}

// ── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const configArg = process.argv[2] || "./guard-run.config.ts";
  const configPath = resolve(configArg);

  // ── Load config ──────────────────────────────────────────────
  let config: { tasks?: TaskDef[] };
  try {
    config = await import(configPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `${RED}Error:${RESET} Could not load config from "${configPath}"`,
    );
    console.error(`       ${msg}`);
    process.exit(1);
  }

  if (!config.tasks || !Array.isArray(config.tasks)) {
    console.error(
      `${RED}Error:${RESET} Config file must export a "tasks" array`,
    );
    process.exit(1);
  }

  if (config.tasks.length === 0) {
    console.log("guard-run: nothing to run");
    process.exit(0);
  }

  // ── Validate DAG ─────────────────────────────────────────────
  const dagResult = validateDAG(config.tasks);
  if (dagResult._tag === "failure") {
    console.error(`${RED}Error:${RESET} ${dagResult.error.message}`);
    process.exit(1);
  }

  const order = dagResult.value;
  const taskMap = new Map<TaskName, TaskDef>(
    config.tasks.map((t) => [t.name, t]),
  );

  // ── Execute in topological order ─────────────────────────────
  let ctx: unknown = {};
  let hasFailure = false;

  for (const name of order) {
    const taskDef = taskMap.get(name);

    // Unknown task or short-circuit after a failure
    if (!taskDef || hasFailure) {
      console.log(`  ${colored("SKIPPED")}  ${name}`);
      continue;
    }

    // Pre-guards — first failure short-circuits this task
    for (const guard of taskDef.pre) {
      if (!guard(ctx)) {
        console.log(`  ${colored("FAIL")}  ${name}`);
        hasFailure = true;
        break;
      }
    }
    if (hasFailure) continue;

    // Task body
    const runResult = taskDef.run(ctx);
    if (runResult._tag === "failure") {
      console.log(`  ${colored("FAIL")}  ${name}`);
      hasFailure = true;
      continue;
    }
    ctx = runResult.value;

    // Post-guards — first failure short-circuits this task
    for (const guard of taskDef.post) {
      if (!guard(ctx)) {
        console.log(`  ${colored("FAIL")}  ${name}`);
        hasFailure = true;
        break;
      }
    }
    if (hasFailure) continue;

    console.log(`  ${colored("PASS")}  ${name}`);
  }

  process.exit(hasFailure ? 1 : 0);
}

await main();
