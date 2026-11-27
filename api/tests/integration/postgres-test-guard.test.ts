import assert from "node:assert/strict";
import { test } from "node:test";
import { configureIsolatedPostgresTestEnvironment } from "./postgres-test-guard.js";

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const allKeys = new Set([
    ...Object.keys(values),
    "DATABASE_URL",
    "DOTENV_CONFIG_PATH",
    "DOTENV_CONFIG_OVERRIDE",
    "NODE_ENV",
  ]);
  const previous = Object.fromEntries([...allKeys].map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("test URL guard accepts loopback test database and disables dotenv file loading", () => {
  const url = "postgresql://test_user:test_password@127.0.0.1:55439/garmentbiz_test_guard?application_name=guard_test";
  withEnvironment({ GARMENTBIZ_TEST_DATABASE_URL: url, DATABASE_URL: "postgresql://not-used@invalid/app" }, () => {
    assert.equal(configureIsolatedPostgresTestEnvironment(), url);
    assert.equal(process.env.DATABASE_URL, url);
    assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
    assert.equal(process.env.DOTENV_CONFIG_OVERRIDE, "false");
  });
  const ipv6 = "postgresql://test_user:test_password@[::1]:55439/garmentbiz_test_ipv6";
  withEnvironment({ GARMENTBIZ_TEST_DATABASE_URL: ipv6 }, () => {
    assert.equal(configureIsolatedPostgresTestEnvironment(), ipv6);
  });
});

test("test URL guard rejects missing explicit test URL without falling back to DATABASE_URL", () => {
  const applicationUrl = "postgresql://secret@localhost/garmentbiz_dev";
  withEnvironment({ GARMENTBIZ_TEST_DATABASE_URL: undefined, DATABASE_URL: applicationUrl }, () => {
    assert.throws(configureIsolatedPostgresTestEnvironment, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(applicationUrl), false);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
    assert.equal(process.env.DATABASE_URL, applicationUrl);
  });
});

test("test URL guard rejects remote hosts, non-test database names, and host overrides", () => {
  for (const url of [
    "postgresql://user:password@db.example.test/garmentbiz_test_case",
    "postgresql://user:password@localhost/neondb",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_case?host=db.example.test",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_neondb",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_production",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_case?HOST=remote.example.test",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_case?hostaddr=192.0.2.1",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_case?service=remote",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_case?options=-c%20host=remote",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_case?sslpassword=secret",
    "postgresql://user:password@/garmentbiz_test_socket",
    "postgresql://user:password@127.0.0.1/garmentbiz_test_%ZZ",
    "mysql://user:password@127.0.0.1/garmentbiz_test_wrong_protocol",
    "postgresql://127.0.0.1/garmentbiz_test_missing_credentials",
  ]) {
    withEnvironment({ GARMENTBIZ_TEST_DATABASE_URL: url }, () => {
      assert.throws(configureIsolatedPostgresTestEnvironment, Error);
    });
  }
});
