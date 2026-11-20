import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeEnvSettings } from '../../../src/testing/env-file.js';
import { TestSupportError } from '../../../src/testing/test-support-error.js';

const OWNER_ONLY_MODE = 0o600;
const MODE_MASK = 0o777;
const GROUP_READABLE_MODE = 0o640;
const SECRET = 'Bearer secret.value.here';
let directory = '';
let file = '';

const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & MODE_MASK;

const failureOf = async (action: () => Promise<unknown>): Promise<Error> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('the action did not fail');
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'identity-kit-env-'));
  file = join(directory, '.env');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('writing settings to an environment file', () => {
  it('creates a missing file with owner-only mode and the requested lines', async () => {
    await writeEnvSettings(file, { FIRST: 'one', SECOND: 'two' });

    expect(await readFile(file, 'utf8')).toBe('FIRST=one\nSECOND=two\n');
    expect(await modeOf(file)).toBe(OWNER_ONLY_MODE);
  });

  it('replaces only the line of a name already present and keeps the other lines in order', async () => {
    await writeFile(file, '# comment\nKEEP_A=a\nFIRST=old\n\nKEEP_B=b\n', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'new' });

    expect(await readFile(file, 'utf8')).toBe('# comment\nKEEP_A=a\nFIRST=new\n\nKEEP_B=b\n');
  });

  it('replaces a line written with the export prefix, keeps the prefix and drops no other line', async () => {
    await writeFile(file, 'export FIRST=old\nKEEP=k\n', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'new' });

    expect(await readFile(file, 'utf8')).toBe('export FIRST=new\nKEEP=k\n');
  });

  it('keeps the indentation of the line it replaces', async () => {
    await writeFile(file, '  export FIRST=old\n\tSECOND=old\n', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'new', SECOND: 'new' });

    expect(await readFile(file, 'utf8')).toBe('  export FIRST=new\n\tSECOND=new\n');
  });

  it('keeps the CRLF line endings of a file that uses them, in the lines it adds as well', async () => {
    await writeFile(file, 'KEEP=k\r\nFIRST=old\r\n', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'new', SECOND: 'two' });

    expect(await readFile(file, 'utf8')).toBe('KEEP=k\r\nFIRST=new\r\nSECOND=two\r\n');
  });

  it('appends the names that are missing after the existing lines', async () => {
    await writeFile(file, 'KEEP=k\nFIRST=old', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'new', SECOND: 'two' });

    expect(await readFile(file, 'utf8')).toBe('KEEP=k\nFIRST=new\nSECOND=two\n');
  });

  it('does not take a name for another that starts with it', async () => {
    await writeFile(file, 'FIRST_EXTRA=x\n', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'one' });

    expect(await readFile(file, 'utf8')).toBe('FIRST_EXTRA=x\nFIRST=one\n');
  });

  it('keeps the mode of a file that already exists', async () => {
    await writeFile(file, 'KEEP=k\n');
    await chmod(file, GROUP_READABLE_MODE);

    await writeEnvSettings(file, { FIRST: 'one' });

    expect(await modeOf(file)).toBe(GROUP_READABLE_MODE);
  });

  it('keeps an owner-only file owner-only', async () => {
    await writeFile(file, 'KEEP=k\n', { mode: OWNER_ONLY_MODE });

    await writeEnvSettings(file, { FIRST: 'one' });

    expect(await modeOf(file)).toBe(OWNER_ONLY_MODE);
  });

  it.each(['line\nbreak', 'line\rbreak', 'line\r\nbreak'])(
    'refuses a value with a line break and leaves the file as it was (%j)',
    async (value) => {
      await writeFile(file, 'KEEP=k\n', { mode: OWNER_ONLY_MODE });

      const failure = await failureOf(() => writeEnvSettings(file, { FIRST: 'fine', SECOND: `${SECRET}${value}` }));

      expect(await readFile(file, 'utf8')).toBe('KEEP=k\n');
      expect(failure).toBeInstanceOf(TestSupportError);
      expect(failure.message).not.toContain(SECRET);
    },
  );

  it('creates no file when it refuses a value with a line break', async () => {
    await failureOf(() => writeEnvSettings(file, { FIRST: 'line\nbreak' }));

    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['', 'with space', '1STARTS_WITH_DIGIT', 'A=B', 'A.*', 'LINE\nBREAK'])(
    'refuses the name %j and leaves the file as it was',
    async (name) => {
      await writeFile(file, 'KEEP=k\n', { mode: OWNER_ONLY_MODE });

      const failure = await failureOf(() => writeEnvSettings(file, { [name]: SECRET }));

      expect(await readFile(file, 'utf8')).toBe('KEEP=k\n');
      expect(failure).toBeInstanceOf(TestSupportError);
    },
  );

  it('returns nothing, so the values written never go back to the caller', async () => {
    expect(await writeEnvSettings(file, { FIRST: SECRET })).toBeUndefined();
  });

  it('keeps a value that holds an equals sign or spaces as one line', async () => {
    await writeEnvSettings(file, { FIRST: 'a=b c' });

    expect(await readFile(file, 'utf8')).toBe('FIRST=a=b c\n');
  });
});
