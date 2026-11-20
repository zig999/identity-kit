import { bearerTokenOf } from './bearer.js';
import { createCaller } from './caller.js';
export const createAuthenticator = (verifier) => ({
    async authenticate(authorization, audience) {
        const token = bearerTokenOf(authorization);
        if (token === undefined)
            return undefined;
        const claims = await verifier.verify(token, audience);
        return claims === undefined ? undefined : createCaller(claims);
    },
});
