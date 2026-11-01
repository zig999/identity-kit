const BEARER_AUTHORIZATION = /^bearer ([\w.~+/-]+=*)$/i;

export const bearerTokenOf = (authorization: string | undefined): string | undefined =>
  authorization === undefined ? undefined : BEARER_AUTHORIZATION.exec(authorization)?.[1];
