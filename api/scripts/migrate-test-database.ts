import { runGuardedTestDatabaseCommand } from "../tests/integration/guarded-process.js";

await runGuardedTestDatabaseCommand("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  cwd: process.cwd(),
  redactOutput: true,
});
