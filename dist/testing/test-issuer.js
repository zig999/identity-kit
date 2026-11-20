import { createServer } from 'node:http';
import { z } from 'zod';
import { generateSigningKey, signToken } from './signing.js';
const LOOPBACK = '127.0.0.1';
const EPHEMERAL_PORT = 0;
const DISCOVERY_PATH = '/.well-known/openid-configuration';
const KEYS_PATH = '/keys';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const ISSUE_PATH = '/issue';
const TRAILING_SLASHES = /\/+$/u;
const DEFAULT_LIFETIME_SECONDS = 3600;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_SUBJECT = 'test-caller';
const IssueRequestSchema = z.object({
    audience: z.string(),
    subject: z.string().optional(),
    roles: z.array(z.string()).optional(),
});
const portOf = (server) => {
    const address = server.address();
    if (address === null || typeof address === 'string')
        throw new Error('the test issuer did not bind a TCP address');
    return address.port;
};
const answerJson = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
};
const keyRingOf = (alg) => {
    let sequence = 0;
    const nextKey = () => generateSigningKey(`test-issuer-key-${String((sequence += 1))}`, alg);
    let keys = [nextKey()];
    return {
        current: () => keys.at(-1) ?? nextKey(),
        published: () => keys,
        rotate: (retireCurrent) => {
            const key = nextKey();
            keys = retireCurrent ? [key] : [...keys, key];
            return key;
        },
    };
};
const readBody = async (request) => {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(String(chunk)));
    return Buffer.concat(chunks).toString('utf8');
};
const parseIssueRequest = (body) => {
    try {
        const parsed = IssueRequestSchema.safeParse(JSON.parse(body));
        return parsed.success ? parsed.data : undefined;
    }
    catch {
        return undefined;
    }
};
const answerIssue = async (request, response, issuance) => {
    const asked = parseIssueRequest(await readBody(request));
    if (asked === undefined) {
        answerJson(response, HTTP_BAD_REQUEST, {});
        return;
    }
    const extra = { ...(asked.subject === undefined ? {} : { sub: asked.subject }) };
    const claims = asked.roles === undefined ? extra : { ...extra, roles: asked.roles };
    answerJson(response, HTTP_OK, { token: issuance.issue(issuance.claims(asked.audience, claims)) });
};
const route = (routes, request, response) => {
    const url = routes.url();
    routes.requests.push(request.url ?? '');
    if (request.url === DISCOVERY_PATH)
        answerJson(response, HTTP_OK, { issuer: url, jwks_uri: `${url}${KEYS_PATH}` });
    else if (request.url === KEYS_PATH)
        answerJson(response, HTTP_OK, { keys: routes.ring.published().map((key) => key.jwk) });
    else if (request.url === ISSUE_PATH && request.method === 'POST' && routes.issuance !== undefined) {
        void answerIssue(request, response, routes.issuance);
    }
    else
        answerJson(response, HTTP_NOT_FOUND, {});
};
const serve = async (listening, routes) => {
    let url = listening.publicUrl?.replace(TRAILING_SLASHES, '') ?? '';
    const server = createServer((request, response) => route({ ...routes, url: () => url }, request, response));
    await new Promise((resolve) => server.listen(listening.port, listening.host, resolve));
    if (url === '')
        url = `http://${listening.host}:${String(portOf(server))}`;
    return { server, url };
};
const issuanceOf = (ring, options) => {
    const now = options.now ?? (() => new Date());
    const lifetime = options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
    let url = '';
    return {
        bindIssuer: (issuerUrl) => {
            url = issuerUrl;
        },
        issuance: {
            claims: (audience, extra = {}) => ({
                iss: url,
                aud: audience,
                sub: DEFAULT_SUBJECT,
                exp: Math.floor(now().getTime() / MILLISECONDS_PER_SECOND) + lifetime,
                ...extra,
            }),
            issue: (claims) => signToken(claims, ring.current()),
        },
    };
};
export const createTestIssuer = async (options = {}) => {
    const alg = options.alg ?? 'ES256';
    const requests = [];
    const ring = keyRingOf(alg);
    const { issuance, bindIssuer } = issuanceOf(ring, options);
    const listening = {
        host: options.host ?? LOOPBACK,
        port: options.port ?? EPHEMERAL_PORT,
        publicUrl: options.publicUrl,
    };
    const serving = await serve(listening, {
        ring,
        requests,
        issuance: options.issuanceRoute === true ? issuance : undefined,
    });
    bindIssuer(serving.url);
    const foreign = generateSigningKey('foreign-key', alg);
    return {
        url: serving.url,
        requests,
        ...issuance,
        issueForeign: (claims) => signToken(claims, foreign, ring.current().kid),
        rotateKey: (rotation = {}) => ring.rotate(rotation.retireCurrent === true),
        close: async () => {
            serving.server.closeAllConnections();
            await new Promise((resolve) => serving.server.close(() => resolve()));
        },
    };
};
