import { describe, expect, it } from 'vitest';

import { OPERATION_TYPES, defineClaimsSchema } from '../../src/claims.js';

const schema = defineClaimsSchema({ resources: ['productOffering', 'hub'] });
const BASE = { iss: 'https://issuer.example.test', aud: 'this-module', exp: 1_800_000_000 };

const accepts = (claims: Record<string, unknown>): boolean => schema.safeParse({ ...BASE, ...claims }).success;

describe('the claims every module reads', () => {
  it.each([
    { label: 'only issuer, audience and expiry', claims: {} },
    { label: 'an audience that is a list', claims: { aud: ['this-module', 'another'] } },
    {
      label: 'a subject, an authorized party and a start of validity',
      claims: { sub: 'caller-1', azp: 'client-1', nbf: 1_700_000_000 },
    },
    { label: 'roles', claims: { roles: ['auditor', 'catalog-administrator'] } },
    { label: 'an empty roles list', claims: { roles: [] } },
    { label: 'a claim no module declared', claims: { tenant: 'north' } },
  ])('are accepted with $label', ({ claims }) => {
    expect(accepts(claims)).toBe(true);
  });

  it.each([
    { label: 'no issuer', claims: { iss: undefined } },
    { label: 'no audience', claims: { aud: undefined } },
    { label: 'no expiry', claims: { exp: undefined } },
    { label: 'an issuer that is a number', claims: { iss: 1 } },
    { label: 'an audience that is a number', claims: { aud: 1 } },
    { label: 'an expiry that is a string', claims: { exp: '1800000000' } },
    { label: 'a start of validity that is a string', claims: { nbf: 'soon' } },
    { label: 'a subject that is a number', claims: { sub: 7 } },
    { label: 'roles that are a string', claims: { roles: 'auditor' } },
    { label: 'roles holding a non-string', claims: { roles: ['auditor', 2] } },
  ])('are refused with $label', ({ claims }) => {
    expect(accepts(claims)).toBe(false);
  });

  it('keeps the claims no module declared in what it yields', () => {
    const parsed = schema.parse({ ...BASE, tenant: 'north' });

    expect(parsed['tenant']).toBe('north');
  });
});

describe('the access rights a token carries', () => {
  it('lists the five operation types every module shares', () => {
    expect(OPERATION_TYPES).toEqual(['create', 'read', 'update', 'delete', 'discover']);
  });

  it('are accepted for each resource the module declares, with any of the five operation types', () => {
    expect(accepts({ accessRights: { productOffering: [...OPERATION_TYPES], hub: ['create'] } })).toBe(true);
  });

  it('are accepted when they list no operation for a resource', () => {
    expect(accepts({ accessRights: { productOffering: [] } })).toBe(true);
  });

  it.each([
    { label: 'a string', value: 'read' },
    { label: 'an array', value: [] },
    { label: 'null', value: null },
    { label: 'a resource mapped to a string', value: { productOffering: 'read' } },
    { label: 'a resource the module does not declare', value: { quote: ['read'] } },
    { label: 'the plural of a resource the module declares', value: { productOfferings: ['read'] } },
    { label: 'the resource in another letter case', value: { ProductOffering: ['read'] } },
    { label: 'an operation outside the five', value: { productOffering: ['read', 'list'] } },
    { label: 'an operation in another letter case', value: { productOffering: ['Read'] } },
  ])('are refused when they are $label', ({ value }) => {
    expect(accepts({ accessRights: value })).toBe(false);
  });
});

describe('the predefined filters a token carries', () => {
  it('are accepted as string values per attribute, per resource the module declares', () => {
    expect(accepts({ predefinedFilters: { productOffering: { lifecycleStatus: 'Active,Launched' }, hub: {} } })).toBe(
      true,
    );
  });

  it('are accepted for an attribute that is not a first-level attribute of the resource', () => {
    expect(accepts({ predefinedFilters: { productOffering: { 'productSpecification.id': 'spec-1' } } })).toBe(true);
  });

  it.each([
    { label: 'a string', value: 'Active' },
    { label: 'an array', value: [] },
    { label: 'null', value: null },
    { label: 'a resource mapped to a string', value: { productOffering: 'Active' } },
    { label: 'a resource mapped to an array', value: { productOffering: ['Active'] } },
    { label: 'an attribute whose value is a number', value: { productOffering: { rank: 3 } } },
    { label: 'an attribute whose value is an object', value: { productOffering: { rank: { a: 'b' } } } },
    { label: 'a resource the module does not declare', value: { quote: { state: 'x' } } },
    { label: 'the plural of a resource the module declares', value: { productOfferings: { state: 'x' } } },
  ])('are refused when they are $label', ({ value }) => {
    expect(accepts({ predefinedFilters: value })).toBe(false);
  });
});

describe('the resources each module declares', () => {
  it('limit the claims a module accepts to its own resource names', () => {
    const quoteModule = defineClaimsSchema({ resources: ['quote'] });

    const answers = [
      quoteModule.safeParse({ ...BASE, accessRights: { quote: ['read'] } }).success,
      quoteModule.safeParse({ ...BASE, accessRights: { productOffering: ['read'] } }).success,
    ];

    expect(answers).toEqual([true, false]);
  });

  it('accept no resource at all when the module declares none', () => {
    const none = defineClaimsSchema({ resources: [] });

    expect([
      none.safeParse({ ...BASE }).success,
      none.safeParse({ ...BASE, accessRights: { anything: ['read'] } }).success,
    ]).toEqual([true, false]);
  });
});
