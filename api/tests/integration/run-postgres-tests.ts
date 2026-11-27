import { runGuardedTestDatabaseCommand } from "./guarded-process.js";

const cwd = process.cwd();
await runGuardedTestDatabaseCommand(process.execPath, [
  "--import", "tsx",
  "--test", "--test-concurrency=1",
  "tests/integration/employee-invitations.postgres.test.ts",
], { cwd, redactOutput: true });
