import { spawn } from "node:child_process";
import { configureIsolatedPostgresTestEnvironment } from "./postgres-test-guard.js";

function sanitizedOutput(output: string, validatedUrl: string): string {
  const parsed = new URL(validatedUrl);
  const decode = (value: string) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };
  const values = [
    validatedUrl,
    decode(parsed.username),
    decode(parsed.password),
    `${decode(parsed.username)}:${decode(parsed.password)}`,
  ].filter(Boolean);
  return values.reduce((result, secret) => result.split(secret).join("[redacted]"), output);
}

function safeChildEnvironment(validatedUrl: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.GARMENTBIZ_TEST_DATABASE_URL = validatedUrl;
  env.DATABASE_URL = validatedUrl;
  env.DOTENV_CONFIG_PATH = "/dev/null";
  env.DOTENV_CONFIG_OVERRIDE = "false";
  env.NODE_ENV = "test";
  return env;
}

/** Validate first, then run a command with no inherited Node preload hooks. */
export async function runGuardedTestDatabaseCommand(
  command: string,
  args: string[],
  options: { cwd: string; redactOutput?: boolean },
): Promise<void> {
  const validatedUrl = configureIsolatedPostgresTestEnvironment();
  const env = safeChildEnvironment(validatedUrl);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });

  const forwardInterrupt = (signal: NodeJS.Signals) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  process.on("SIGINT", forwardInterrupt);
  process.on("SIGTERM", forwardInterrupt);

  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", () => reject(new Error("Unable to start guarded test database command")));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    const clean = (value: string) => options.redactOutput ? sanitizedOutput(value, validatedUrl) : value;
    if (stdout) process.stdout.write(clean(stdout));
    if (stderr) process.stderr.write(clean(stderr));
    if (result.signal) {
      process.exitCode = 128 + (result.signal === "SIGINT" ? 2 : result.signal === "SIGTERM" ? 15 : 1);
    } else {
      process.exitCode = result.code ?? 1;
    }
  } catch {
    process.stderr.write("Guarded test database command could not be started.\n");
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", forwardInterrupt);
    process.off("SIGTERM", forwardInterrupt);
  }
}
