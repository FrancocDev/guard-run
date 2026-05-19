import { $ } from "bun";
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ── Test helpers ────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
const TMP = join(PROJECT_ROOT, ".test-tmp");

function cleanTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

/**
 * Write a temporary guard-run config file for testing.
 *
 * The config body receives `task` and `TaskName` pre-imported from the
 * guard-run source so tests can focus on the scenario logic.
 */
function writeTestConfig(name: string, configBody: string): string {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });

  const src = join(PROJECT_ROOT, "src");
  const content = [
    `import { task } from "${src}/task.ts";`,
    `import type { TaskName } from "${src}/types.ts";`,
    "",
    configBody,
  ].join("\n");

  const configPath = join(dir, "guard-run.config.ts");
  writeFileSync(configPath, content);
  return configPath;
}

// ── Tests ───────────────────────────────────────────────────────

describe("CLI", () => {
  const cliPath = join(PROJECT_ROOT, "src/cli.ts");

  beforeEach(() => cleanTmp());
  afterAll(() => cleanTmp());

  it("exits 0 and prints PASS when all tasks succeed", async () => {
    const configPath = writeTestConfig(
      "all-pass",
      [
        `const t = task("lint" as TaskName).run(() => "ok").build();`,
        `export const tasks = [t];`,
      ].join("\n"),
    );

    const result = await $`bun run ${cliPath} ${configPath}`.quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toMatch(/PASS/);
    expect(stdout).toMatch(/lint/);
  });

  it("exits 1 and prints FAIL when a guard fails", async () => {
    const configPath = writeTestConfig(
      "guard-fails",
      [
        `const g = (x: unknown): x is string => false;`,
        `const t = task("check" as TaskName).pre(g).run(() => "ok").build();`,
        `export const tasks = [t];`,
      ].join("\n"),
    );

    const result =
      await $`bun run ${cliPath} ${configPath}`.nothrow().quiet();
    expect(result.exitCode).toBe(1);
    const stdout = result.stdout.toString();
    expect(stdout).toMatch(/FAIL/);
    expect(stdout).toMatch(/check/);
  });

  it("exits 1 with error when config file is missing", async () => {
    const result =
      await $`bun run ${cliPath} /tmp/nonexistent--guard-run--config.ts`
        .nothrow().quiet();
    expect(result.exitCode).toBe(1);
    const stderr = result.stderr.toString();
    expect(stderr).toMatch(/Error/);
    expect(stderr).toMatch(/Could not load config/);
  });

  it("exits 0 and prints message when tasks array is empty", async () => {
    const configPath = writeTestConfig("empty-tasks", [
      `export const tasks: Array<never> = [];`,
    ].join("\n"));

    const result = await $`bun run ${cliPath} ${configPath}`.quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toMatch(/nothing to run/);
  });

  it("exits 1 and prints FAIL+SKIPPED when a downstream task is skipped", async () => {
    const configPath = writeTestConfig(
      "downstream-skipped",
      [
        `const fail = (x: unknown): x is string => false;`,
        `const a = task("a" as TaskName).pre(fail).run(() => "ok").build();`,
        `const b = task("b" as TaskName).dependsOn("a" as TaskName).run(() => "ok").build();`,
        `export const tasks = [a, b];`,
      ].join("\n"),
    );

    const result =
      await $`bun run ${cliPath} ${configPath}`.nothrow().quiet();
    expect(result.exitCode).toBe(1);
    const stdout = result.stdout.toString();
    expect(stdout).toMatch(/FAIL/);
    expect(stdout).toMatch(/SKIPPED/);
  });

  it("exits 1 when config has no tasks export", async () => {
    const configPath = writeTestConfig("no-export", [
      `export const something = "else";`,
    ].join("\n"));

    const result =
      await $`bun run ${cliPath} ${configPath}`.nothrow().quiet();
    expect(result.exitCode).toBe(1);
    const stderr = result.stderr.toString();
    expect(stderr).toMatch(/Error/);
    expect(stderr).toMatch(/must export/);
  });
});
