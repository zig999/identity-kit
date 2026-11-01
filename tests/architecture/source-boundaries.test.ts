import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = new URL('../../src/', import.meta.url).pathname;

const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
  );

const sources = filesUnder(SOURCE_ROOT)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ path: relative(SOURCE_ROOT, file), text: readFileSync(file, 'utf8') }));

const specifiersOf = (text: string): string[] =>
  [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

const importsOf = (inside: (path: string) => boolean): { path: string; specifier: string }[] =>
  sources
    .filter((source) => inside(source.path))
    .flatMap((source) => specifiersOf(source.text).map((specifier) => ({ path: source.path, specifier })));

const isClient = (path: string): boolean => path.startsWith('client/');

describe('the imports of the package', () => {
  it('reach only node built-ins, zod and the files of the package', () => {
    const foreign = importsOf(() => true).filter(
      ({ specifier }) => !specifier.startsWith('.') && !specifier.startsWith('node:') && specifier !== 'zod',
    );

    expect(foreign).toEqual([]);
  });

  it('keep the client side free of the verification side', () => {
    const reaching = importsOf(isClient).filter(({ specifier }) => specifier.startsWith('../'));

    expect(reaching).toEqual([]);
  });

  it('keep the verification side free of the client side', () => {
    const reaching = importsOf((path) => !isClient(path)).filter(({ specifier }) => specifier.includes('client/'));

    expect(reaching).toEqual([]);
  });
});

describe('the source of the package', () => {
  it('writes nothing to the console', () => {
    expect(sources.filter(({ text }) => /\bconsole\./.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('reads no environment variable', () => {
    expect(sources.filter(({ text }) => /process\.env/.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('names no module of the sales system', () => {
    const names = /(product-?catalog|product-?order|partymgmt|configurator|inventory)/i;

    expect(sources.filter(({ text }) => names.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('keeps the token out of every error message it builds', () => {
    const interpolating = sources.filter(({ text }) => /new \w*Error\([^)]*\$\{[^}]*token/i.test(text));

    expect(interpolating.map(({ path }) => path)).toEqual([]);
  });
});
