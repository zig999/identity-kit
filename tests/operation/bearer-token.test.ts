import { describe, expect, it } from 'vitest';

import { bearerTokenOf } from '../../src/bearer.js';

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln';

describe('the Bearer token read from an Authorization header', () => {
  it.each(['Bearer', 'bearer', 'BEARER', 'BeArEr'])('reads the token under the scheme written as %s', (scheme) => {
    expect(bearerTokenOf(`${scheme} ${TOKEN}`)).toBe(TOKEN);
  });

  it('reads a token ending in padding characters', () => {
    expect(bearerTokenOf('Bearer abc.def.ghi==')).toBe('abc.def.ghi==');
  });
});

describe('an Authorization header that carries no Bearer token', () => {
  it.each([
    { label: 'is absent', header: undefined },
    { label: 'is empty', header: '' },
    { label: 'names the Basic scheme', header: `Basic ${TOKEN}` },
    { label: 'names no scheme', header: TOKEN },
    { label: 'names Bearer with no token', header: 'Bearer' },
    { label: 'names Bearer with a blank token', header: 'Bearer ' },
    { label: 'separates scheme and token by two spaces', header: `Bearer  ${TOKEN}` },
    { label: 'separates scheme and token by a tab', header: `Bearer\t${TOKEN}` },
    { label: 'carries two tokens', header: `Bearer ${TOKEN} ${TOKEN}` },
    { label: 'carries a token with a character outside the token alphabet', header: 'Bearer abc$def' },
    { label: 'carries leading whitespace', header: ` Bearer ${TOKEN}` },
    { label: 'carries trailing whitespace', header: `Bearer ${TOKEN} ` },
    { label: 'carries a line break inside the token', header: 'Bearer abc\ndef' },
  ])('yields no token when the header $label', ({ header }) => {
    expect(bearerTokenOf(header)).toBeUndefined();
  });
});
