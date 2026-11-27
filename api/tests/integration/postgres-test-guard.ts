const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const BLOCKED_DATABASE_IDENTITIES = new Set([
  "dev", "development", "staging", "prod", "production", "demo",
]);
const ALLOWED_QUERY_PARAMETERS = new Set([
  "application_name",
  "channel_binding",
  "connect_timeout",
  "connection_limit",
  "pgbouncer",
  "pool_timeout",
  "schema",
  "sslaccept",
  "sslcert",
  "sslidentity",
  "sslmode",
  "sslrootcert",
]);

function configurationError(): never {
  throw new Error(
    "Integration tests require GARMENTBIZ_TEST_DATABASE_URL for a loopback garmentbiz_test_* database; DATABASE_URL fallback is disabled",
  );
}

/** Validate before any application module or Prisma client is dynamically imported. */
export function configureIsolatedPostgresTestEnvironment(): string {
  const rawUrl = process.env.GARMENTBIZ_TEST_DATABASE_URL;
  if (!rawUrl || rawUrl !== rawUrl.trim() || /[\r\n\0]/.test(rawUrl)) configurationError();

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return configurationError();
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return configurationError();
  }
  const normalizedDatabaseName = databaseName.toLowerCase();
  const databaseSuffix = normalizedDatabaseName.replace(/^garmentbiz_test_/, "");
  const blockedName = normalizedDatabaseName.includes("neondb") ||
    databaseSuffix.split("_").some((part) => BLOCKED_DATABASE_IDENTITIES.has(part));
  const unsupportedQueryParameter = [...parsed.searchParams.keys()].some((key) =>
    !ALLOWED_QUERY_PARAMETERS.has(key.toLowerCase()),
  );
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !ALLOWED_LOOPBACK_HOSTS.has(hostname) ||
    !/^garmentbiz_test_[a-z0-9_]+$/.test(normalizedDatabaseName) ||
    blockedName ||
    !parsed.username ||
    !parsed.password ||
    parsed.hash ||
    unsupportedQueryParameter
  ) {
    configurationError();
  }

  // dotenv/config is imported by the application's Prisma module. Point it at an
  // empty file and set DATABASE_URL first so api/.env cannot affect this process.
  process.env.DATABASE_URL = rawUrl;
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  process.env.DOTENV_CONFIG_OVERRIDE = "false";
  process.env.NODE_ENV = "test";
  return rawUrl;
}
