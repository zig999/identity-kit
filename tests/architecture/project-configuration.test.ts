import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

const manifest = readJson('package.json');

describe('project configuration', () => {
  it('requires Node 24 or later', () => {
    expect(manifest['engines']).toEqual({ node: '>=24' });
  });

  it('is an ES module package', () => {
    expect(manifest['type']).toBe('module');
  });

  it('has zod as its only runtime dependency', () => {
    expect(Object.keys(manifest['dependencies'] as object)).toEqual(['zod']);
  });

  it('publishes only compiled files through its exports', () => {
    expect(manifest['files']).toEqual(['dist']);
    const exported = JSON.stringify(manifest['exports']);
    expect(exported).not.toContain('src/');
    expect(exported).toContain('./dist/');
  });

  it('declares the verification scripts', () => {
    const scripts = Object.keys(manifest['scripts'] as object);
    expect(scripts).toEqual(expect.arrayContaining(['typecheck', 'lint', 'format', 'test', 'build', 'duplication']));
  });

  it('keeps the compiled output out of the working tree history', () => {
    expect(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')).toContain('dist/');
  });
});
