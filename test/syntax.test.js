import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// Some modules import prompt .txt files, so the unit tests cannot load them. Parse every file instead.
test('every server and browser script parses', () => {
  const dirs = ['functions/lib', 'functions/api', 'functions/m', 'workers/mailer', 'public/assets'];
  const files = dirs.flatMap((d) => readdirSync(new URL(`../${d}/`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
  assert.ok(files.length > 20);
  for (const f of files) assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }), f);
});
