import { expect, test } from "bun:test";
import { withPostgresDatabase, runPostgresScript } from "./postgres";

test("PostgreSQL auth survives backup and restore with synthetic private files", async () => {
  await withPostgresDatabase(async (sourceUrl) => {
    await withPostgresDatabase(async (targetUrl) => {
      const script = `
        import assert from 'node:assert/strict';
        import { spawnSync } from 'node:child_process';
        import { mkdtempSync, mkdirSync, chmodSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        const sourceUrl = ${JSON.stringify(sourceUrl)};
        const targetUrl = ${JSON.stringify(targetUrl)};
        const dataDir = process.env.CURATOR_DATA_DIR;
        const backupDir = mkdtempSync(join(tmpdir(), 'curator-backup-test-'));
        chmodSync(backupDir,0o755);
        const secret = 'synthetic-auth-secret-preserved-across-restore';
        writeFileSync(join(dataDir, 'auth-secret'), secret + '\\n', { mode: 0o600 });
        mkdirSync(join(dataDir, 'media', 'synthetic'), { recursive: true });
        writeFileSync(join(dataDir, 'media', 'synthetic', 'fixture.txt'), 'synthetic media fixture');
        try {
          process.env.DATABASE_URL = sourceUrl;
          process.env.BETTER_AUTH_SECRET = secret;
          const { migrateAppDatabase, db, pool } = await import('./src/lib/db.ts');
          await migrateAppDatabase();
          const { auth } = await import('./src/lib/auth.ts');
          const password = 'synthetic-password-42';
          const signup = await auth.api.signUpEmail({
            body: { name: 'Synthetic First Admin', email: 'admin@example.invalid', password },
            headers: new Headers({ origin: 'http://localhost:3000' }), asResponse: true,
          });
          assert.equal(signup.status, 200);
          const signupBody = await signup.clone().json();
          assert.equal(signupBody.user.role, 'admin');
          const deniedSignup = await auth.api.signUpEmail({
            body: { name: 'Synthetic Public User', email: 'second@example.invalid', password },
            headers: new Headers({ origin: 'http://localhost:3000' }), asResponse: true,
          });
          assert.equal(deniedSignup.status, 403);
          const signin = await auth.api.signInEmail({
            body: { email: 'admin@example.invalid', password },
            headers: new Headers({ origin: 'http://localhost:3000' }), asResponse: true,
          });
          assert.equal(signin.status, 200);
          const setCookie = signin.headers.get('set-cookie');
          assert.ok(setCookie);
          const cookie = setCookie.split(';', 1)[0];
          const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
          assert.equal(session?.user.email, 'admin@example.invalid');
          const originalPasswordHash = (await db.one('SELECT password FROM account WHERE "userId"=$1', [signupBody.user.id])).password;
          assert.ok(originalPasswordHash);
          await db.execute("INSERT INTO app_settings(key,value_json,is_secret) VALUES ('synthetic.backup_fixture','{\\\"kept\\\":true}',0)");

          const backup = spawnSync('node', ['--import', 'tsx', 'scripts/backup.ts', backupDir], {
            cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: sourceUrl, CURATOR_DATA_DIR: dataDir, BETTER_AUTH_SECRET: secret },
          });
          assert.equal(backup.status, 0, backup.stderr + backup.stdout);
          const exported = JSON.parse(readFileSync(join(backupDir, 'library.json'), 'utf8'));
          assert.equal(exported.format, 2);
          assert.ok(exported.tables.user.some(row => row.email === 'admin@example.invalid' && row.role === 'admin'));
          assert.ok(exported.tables.account.some(row => row.userId === signupBody.user.id && row.password === originalPasswordHash));
          assert.ok(exported.tables.app_settings.some(row => row.key === 'synthetic.backup_fixture' && row.value_json === '{"kept":true}'));
          await pool.end();

          process.env.DATABASE_URL = targetUrl;
          process.env.CURATOR_DATA_DIR = join(backupDir, 'restored-data');
          process.env.BETTER_AUTH_SECRET = 'different-synthetic-target-secret';
          const restore = spawnSync('node', ['--import', 'tsx', 'scripts/restore.ts', backupDir, '--confirm'], {
            cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: targetUrl, CURATOR_DATA_DIR: process.env.CURATOR_DATA_DIR, BETTER_AUTH_SECRET: '' },
          });
          assert.equal(restore.status, 0, restore.stderr + restore.stdout);
          assert.equal(readFileSync(join(process.env.CURATOR_DATA_DIR, 'auth-secret'), 'utf8').trim(), secret);
          assert.equal(readFileSync(join(process.env.CURATOR_DATA_DIR, 'media', 'synthetic', 'fixture.txt'), 'utf8'), 'synthetic media fixture');
          const verifyCode = [
            "import assert from 'node:assert/strict';",
            "const { auth } = await import('./src/lib/auth.ts');",
            "const signin = await auth.api.signInEmail({ body: { email: 'admin@example.invalid', password: 'synthetic-password-42' }, headers: new Headers({ origin: 'http://localhost:3000' }), asResponse: true });",
            'assert.equal(signin.status, 200);',
            "const cookie = signin.headers.get('set-cookie').split(';', 1)[0];",
            "const session = await auth.api.getSession({ headers: new Headers({ cookie }) });",
            "assert.equal(session?.user.role, 'admin');",
            "const { db, pool } = await import('./src/lib/db.ts');",
            "assert.ok((await db.one('SELECT a.password FROM account a JOIN \\\"user\\\" u ON u.id=a.\\\"userId\\\" WHERE u.email=$1', ['admin@example.invalid'])).password);",
            "assert.deepEqual(await db.one('SELECT value_json FROM app_settings WHERE key=$1', ['synthetic.backup_fixture']), { value_json: '{\\\"kept\\\":true}' });",
            'await pool.end();',
          ].join('\\n');
          const verifyRestored = spawnSync('node', ['--import', 'tsx', '--input-type=module', '-e', verifyCode], {
            cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: targetUrl, CURATOR_DATA_DIR: process.env.CURATOR_DATA_DIR, BETTER_AUTH_SECRET: '' },
          });
          assert.equal(verifyRestored.status, 0, verifyRestored.stderr + verifyRestored.stdout);

          const populated = spawnSync('node', ['--import', 'tsx', 'scripts/restore.ts', backupDir, '--confirm'], {
            cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: targetUrl, CURATOR_DATA_DIR: process.env.CURATOR_DATA_DIR },
          });
          assert.notEqual(populated.status, 0);
          assert.match(populated.stderr + populated.stdout, /requires an empty target/);

          const manifestPath = join(backupDir, 'manifest.json');
          assert.equal(statSync(backupDir).mode & 0o777,0o700);
          assert.equal(statSync(join(backupDir,'private-files.tar.gz')).mode & 0o777,0o600);
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          writeFileSync(join(backupDir, 'library.json'), readFileSync(join(backupDir, 'library.json'), 'utf8') + ' ');
          const tampered = spawnSync('node', ['--import', 'tsx', 'scripts/restore.ts', backupDir, '--confirm'], {
            cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: targetUrl, CURATOR_DATA_DIR: process.env.CURATOR_DATA_DIR },
          });
          assert.notEqual(tampered.status, 0);
          assert.match(tampered.stderr + tampered.stdout, /checksum mismatch/);
          assert.ok(manifest.sha256);
        } finally { rmSync(backupDir, { recursive: true, force: true }); }
      `;
      const result = runPostgresScript(script, sourceUrl, { DATABASE_URL: sourceUrl });
      expect(result.status, result.stderr + result.stdout).toBe(0);
    });
  });
});
