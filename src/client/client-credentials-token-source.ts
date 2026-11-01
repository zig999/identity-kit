import { z } from 'zod';

import type { AccessTokenResult, IAccessTokenNotObtained, IAccessTokenSource } from './access-token-source.js';

export const DEFAULT_TOKEN_ENDPOINT_TIMEOUT_MS = 5000;

const HTTP_OK = 200;
const CLIENT_CREDENTIALS_GRANT = 'client_credentials';
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const BEARER_PATTERN = /^bearer$/i;
const FORM_FIELD = 'value';
const FORM_PREFIX_LENGTH = `${FORM_FIELD}=`.length;

const NOT_OBTAINED: IAccessTokenNotObtained = { obtained: false };

const TokenAnswerSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().regex(BEARER_PATTERN),
  expires_in: z.number().optional().catch(undefined),
});

export interface IClientCredentialsOptions {
  readonly tokenEndpointUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience?: string;
  readonly scope?: string;
  readonly timeoutMs?: number;
}

const formEncode = (value: string): string =>
  new URLSearchParams({ [FORM_FIELD]: value }).toString().slice(FORM_PREFIX_LENGTH);

const basicAuthorization = (clientId: string, clientSecret: string): string =>
  `Basic ${Buffer.from(`${formEncode(clientId)}:${formEncode(clientSecret)}`).toString('base64')}`;

const isSupplied = (value: string | undefined): value is string => value !== undefined && value !== '';

const requestBody = (audience: string | undefined, scope: string | undefined): string => {
  const parameters = new URLSearchParams({ grant_type: CLIENT_CREDENTIALS_GRANT });
  if (isSupplied(audience)) parameters.set('audience', audience);
  if (isSupplied(scope)) parameters.set('scope', scope);
  return parameters.toString();
};

const readAnswer = async (response: Response): Promise<AccessTokenResult> => {
  if (response.status !== HTTP_OK) {
    await response.body?.cancel();
    return NOT_OBTAINED;
  }
  const parsed = TokenAnswerSchema.safeParse(await response.json());
  if (!parsed.success) return NOT_OBTAINED;
  const { access_token: accessToken, expires_in: expiresIn } = parsed.data;
  return { obtained: true, accessToken, ...(expiresIn === undefined ? {} : { expiresIn }) };
};

export const createClientCredentialsTokenSource = (options: IClientCredentialsOptions): IAccessTokenSource => {
  const authorization = basicAuthorization(options.clientId, options.clientSecret);
  const body = requestBody(options.audience, options.scope);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOKEN_ENDPOINT_TIMEOUT_MS;
  return {
    async obtainAccessToken(): Promise<AccessTokenResult> {
      try {
        const response = await fetch(options.tokenEndpointUrl, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': FORM_CONTENT_TYPE, authorization },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        return await readAnswer(response);
      } catch {
        return NOT_OBTAINED;
      }
    },
    reportAccessTokenRefused(): void {
      return;
    },
  };
};
