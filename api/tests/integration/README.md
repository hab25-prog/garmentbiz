# PostgreSQL integration tests

The employee invitation integration suite requires a separately created,
disposable local PostgreSQL database. It is intentionally not run by `pnpm test`.

Before running the suite, an operator must create a new local database whose
name starts with `garmentbiz_test_`, review the complete migration chain, and
apply that chain to the disposable database only. The suite does not create,
drop, reset, or migrate a database. It creates uniquely identified fixture rows
and removes only those rows in a scoped transaction.

The test and migration commands require `GARMENTBIZ_TEST_DATABASE_URL`. Their
launchers validate it before importing application modules or starting Prisma.
They accept only loopback hosts, a `garmentbiz_test_*` database name, and a
small allowlist of non-routing URL options. Host, host-address, socket, service,
and arbitrary connection options are rejected case-insensitively. The launcher
sets `DATABASE_URL` only from the validated URL and redirects `dotenv/config`
to `/dev/null`.

Create separate Prisma clients for concurrent actors. Invitation email delivery
is injected as an in-memory fake; tests never invoke Nodemailer or SMTP.

Run only after a disposable database has been separately authorized and prepared:

```sh
GARMENTBIZ_TEST_DATABASE_URL='postgresql://<local-user>:<local-password>@127.0.0.1:<port>/garmentbiz_test_<unique-name>' pnpm run test:integration
```

The guarded migration launcher is also intended only for a separately
authorized disposable database:

```sh
GARMENTBIZ_TEST_DATABASE_URL='postgresql://<local-user>:<local-password>@127.0.0.1:<port>/garmentbiz_test_<unique-name>' pnpm run migrate:test-db
```

The migration chain currently includes the initial schema and subsequent
additive migrations through `20261126120000_employee_invitations`. On a fresh
disposable database, the entire reviewed chain must be applied in timestamp
order. The guarded migration command runs `prisma migrate deploy`; do not apply
only the invitation migration, because it relies on earlier membership and
audit constraints. No migration command is part of `test:integration`.
