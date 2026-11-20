import { appendFile, readFile, writeFile } from 'node:fs/promises';

import { TestSupportError } from './test-support-error.js';

const FILE_ENCODING = 'utf8';
const NEW_FILE_MODE = 0o600;
const LF = '\n';
const CRLF = '\r\n';
const LINE_BREAK_PATTERN = /[\r\n]/u;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ASSIGNMENT_PATTERN = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/u;
const NAME_REFUSED = 'An environment variable name must be letters, digits and underscores, not starting with a digit';
const VALUE_REFUSED = 'An environment variable value holds a line break and cannot be one line of an env file';

export type EnvSettings = Readonly<Record<string, string>>;

const refuseUnwritable = (settings: EnvSettings): void => {
  for (const [name, value] of Object.entries(settings)) {
    if (!NAME_PATTERN.test(name)) throw new TestSupportError(NAME_REFUSED);
    if (LINE_BREAK_PATTERN.test(value)) throw new TestSupportError(VALUE_REFUSED);
  }
};

const lineEndingOf = (text: string): string => (text.includes(CRLF) ? CRLF : LF);

const linesOf = (text: string, ending: string): string[] => {
  if (text === '') return [];
  return (text.endsWith(ending) ? text.slice(0, -ending.length) : text).split(ending);
};

const replaceSettings = (lines: readonly string[], settings: EnvSettings): string[] => {
  const written = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const [, prefix = '', name = ''] = ASSIGNMENT_PATTERN.exec(line) ?? [];
    if (!Object.hasOwn(settings, name)) result.push(line);
    else if (!written.has(name)) {
      written.add(name);
      result.push(`${prefix}${name}=${settings[name]}`);
    }
  }
  const missing = Object.entries(settings).filter(([name]) => !written.has(name));
  return [...result, ...missing.map(([name, value]) => `${name}=${value}`)];
};

export const writeEnvSettings = async (path: string, settings: EnvSettings): Promise<void> => {
  refuseUnwritable(settings);
  await appendFile(path, '', { mode: NEW_FILE_MODE });
  const text = await readFile(path, FILE_ENCODING);
  const ending = lineEndingOf(text);
  const lines = replaceSettings(linesOf(text, ending), settings);
  await writeFile(path, `${lines.join(ending)}${ending}`, FILE_ENCODING);
};
