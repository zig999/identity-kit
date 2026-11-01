import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';

const LOOPBACK = '127.0.0.1';
const EPHEMERAL_PORT = 0;

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

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

export const tokenAnswer = (body: unknown, status = 200): ITokenEndpointAnswer => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const portOf = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the stand-in did not bind a TCP address');
  return address.port;
};

export const serveTokenEndpoint = async (): Promise<ITokenEndpointStandIn> => {
  const requests: IRecordedTokenRequest[] = [];
  const held: ServerResponse[] = [];
  let answer: ITokenEndpointAnswer = tokenAnswer({ access_token: 'issued', token_type: 'Bearer', expires_in: 300 });
  let silent = false;
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      requests.push({ method: request.method ?? '', headers: request.headers, body });
      if (silent) {
        held.push(response);
        return;
      }
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOOPBACK, resolve));
  return {
    url: `http://${LOOPBACK}:${portOf(server)}/token`,
    requests,
    answerWith: (next) => {
      answer = next;
    },
    neverAnswer: () => {
      silent = true;
    },
    close: async () => {
      held.forEach((response) => response.destroy());
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
