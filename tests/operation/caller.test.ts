import { describe, expect, it } from 'vitest';

import { createCaller } from '../../src/caller.js';
import type { IClaims } from '../../src/claims.js';

const BASE: IClaims = { iss: 'https://issuer.example.test', aud: 'this-module', exp: 1_800_000_000 };

const callerWith = (extra: Partial<IClaims>) => createCaller({ ...BASE, ...extra });

describe('the rights a caller holds', () => {
  it('holds an operation the accessRights claim lists under the resource', () => {
    expect(
      callerWith({ accessRights: { productOffering: ['read', 'discover'] } }).holds({
        resource: 'productOffering',
        type: 'discover',
      }),
    ).toBe(true);
  });

  it('holds no operation the claim leaves out of the resource', () => {
    const caller = callerWith({ accessRights: { productOffering: ['read'], hub: ['create'] } });

    expect(caller.holds({ resource: 'productOffering', type: 'create' })).toBe(false);
  });

  it('holds no operation on a resource the claim does not list', () => {
    expect(callerWith({ accessRights: { hub: ['create'] } }).holds({ resource: 'productOffering', type: 'read' })).toBe(
      false,
    );
  });

  it('holds nothing when the token carries no accessRights claim', () => {
    expect(callerWith({}).holds({ resource: 'productOffering', type: 'read' })).toBe(false);
  });

  it('does not take a role for a right', () => {
    expect(callerWith({ roles: ['catalog-administrator'] }).holds({ resource: 'productOffering', type: 'read' })).toBe(
      false,
    );
  });
});

describe('what a caller exposes', () => {
  it('exposes the subject of the token', () => {
    expect(callerWith({ sub: 'caller-1' }).subject).toBe('caller-1');
  });

  it('exposes no subject when the token carries none', () => {
    expect(callerWith({}).subject).toBeUndefined();
  });

  it('exposes the roles of the token', () => {
    expect(callerWith({ roles: ['auditor', 'catalog-administrator'] }).roles).toEqual([
      'auditor',
      'catalog-administrator',
    ]);
  });

  it('exposes no role when the token carries none', () => {
    expect(callerWith({}).roles).toEqual([]);
  });

  it('exposes the claims it was built from, predefined filters included, untouched', () => {
    const filters = { productOffering: { lifecycleStatus: 'Active' } };

    expect(callerWith({ predefinedFilters: filters }).claims.predefinedFilters).toStrictEqual(filters);
  });

  it('exposes claims without a roles member when the token carried none', () => {
    expect('roles' in callerWith({}).claims).toBe(false);
  });
});
