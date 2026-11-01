import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';

const LOOPBACK = '127.0.0.1';
const EPHEMERAL_PORT = 0;
const JSON_CONTENT_TYPE = 'application/json';
const HTTP_OK = 200;

export interface ITokenEndpointAnswer {
  readonly status: number;
  readonly body: string;
}

export interface IRecordedTokenRequest {
  readonly method: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface ITokenEndpointStandIn {
  readonly url: string;
  readonly requests: IRecordedTokenRequest[];
  answerWith(answer: ITokenEndpointAnswer): void;
  neverAnswer(): void;
  close(): Promise<void>;
}

export const tokenAnswer = (body: unknown, status = HTTP_OK): ITokenEndpointAnswer => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const portOf = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the stand-in did not bind a TCP address');
  return address.port;
};

interface IBehaviour {
  answer: ITokenEndpointAnswer;
  silent: boolean;
}

const handle = async (
  exchange: { request: IncomingMessage; response: ServerResponse },
  behaviour: IBehaviour,
  recorded: { requests: IRecordedTokenRequest[]; held: ServerResponse[] },
): Promise<void> => {
  const { request, response } = exchange;
  const body = await readBody(request);
  recorded.requests.push({ method: request.method ?? '', headers: request.headers, body });
  if (behaviour.silent) {
    recorded.held.push(response);
    return;
  }
  response.writeHead(behaviour.answer.status, { 'content-type': JSON_CONTENT_TYPE });
  response.end(behaviour.answer.body);
};

export const createTokenEndpointStandIn = async (): Promise<ITokenEndpointStandIn> => {
  const requests: IRecordedTokenRequest[] = [];
  const held: ServerResponse[] = [];
  const recorded = { requests, held };
  const behaviour: IBehaviour = {
    answer: tokenAnswer({ access_token: 'issued', token_type: 'Bearer', expires_in: 300 }),
    silent: false,
  };
  const server = createServer((request, response) => {
    void handle({ request, response }, behaviour, recorded);
  });
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOOPBACK, resolve));
  return {
    url: `http://${LOOPBACK}:${String(portOf(server))}/token`,
    requests: recorded.requests,
    answerWith: (next) => {
      behaviour.answer = next;
    },
    neverAnswer: () => {
      behaviour.silent = true;
    },
    close: async () => {
      recorded.held.forEach((response) => response.destroy());
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
