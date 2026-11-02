# identity-kit

Biblioteca de autenticação dos módulos de vendas. Ela verifica o token Bearer (JWT) que chega, obtém o token para chamar outro módulo e traz um emissor OIDC de teste.

O kit autentica; o módulo autoriza. Qual direito cada operação exige, e o que cada filtro significa, é decisão do módulo. O escopo completo está em `CLAUDE.md` e o plano em `PLANO.md`.

- Node 24 (`engines.node >=24`), ESM.
- Uma dependência de runtime: `zod`.
- Não lê variável de ambiente, não escreve em console e não conhece nenhum módulo de vendas.

## Instalação

Por tag git. A tag aponta para um commit que traz o `dist` compilado.

```json
{ "dependencies": { "identity-kit": "github:zig999/identity-kit#v0.1.0" } }
```

Tags são imutáveis. Para atualizar, troque a tag e leia o `CHANGELOG.md`.

## Subcaminhos

| Importação | Conteúdo |
|---|---|
| `identity-kit` | Verificação: `bearerTokenOf`, `createJwksClient`, `createTokenVerifier`, `createAuthenticator`, `createCaller`, `defineClaimsSchema`, `OPERATION_TYPES`, `KeySetLoadError` |
| `identity-kit/client` | Chamada a outro módulo: `createClientCredentialsTokenSource`, `createCachingTokenSource` |
| `identity-kit/testing` | Só para testes: `createTestIssuer`, `createTokenEndpointStandIn`, `generateSigningKey`, `signToken`, `unsignedToken`, `hmacToken` e afins. Nunca em produção |

## Verificar quem chama

```ts
import {
  createAuthenticator,
  createJwksClient,
  createTokenVerifier,
  defineClaimsSchema,
} from 'identity-kit';

const now = (): Date => new Date();

const verifier = createTokenVerifier({
  keySet: createJwksClient({ issuer: config.authIssuer, now }),
  issuer: config.authIssuer,
  claims: defineClaimsSchema({ resources: ['productOrder'] }),
  now,
  onRefusal: (reason) => logger.info({ reason }, 'token refused'),
});

const authenticator = createAuthenticator(verifier);

// no hook de cada rota:
const caller = await authenticator.authenticate(request.headers.authorization, config.authAudience);
if (caller === undefined) return reply.code(401).send(/* corpo do contrato do módulo */);
if (!caller.holds({ resource: 'productOrder', type: 'read' })) return reply.code(403).send(/* idem */);
```

O que o verificador confere, nesta ordem: forma do token, algoritmo (só RS256/384/512 e ES256/384/512; `none` e HS* são recusados), claims, emissor (`iss`), audiência (`aud`), expiração (`exp`), início de validade (`nbf`) e assinatura. Qualquer falha devolve `undefined`. O motivo vai ao callback `onRefusal`, sem o token. Tolerância de relógio: `leewaySeconds` (padrão 0).

Se as chaves do emissor não puderem ser carregadas, a verificação **rejeita com `KeySetLoadError`**, e não recusa o token. O módulo deve responder como indisponibilidade (por exemplo 503), e não como 401.

`createJwksClient` descobre o `jwks_uri` em `<emissor>/.well-known/openid-configuration`, guarda as chaves por 10 minutos, recarrega no mínimo a cada 30 segundos quando uma chave não é encontrada e faz uma só leitura para pedidos concorrentes. `requestHeaders` permite acrescentar cabeçalhos (por exemplo de trace) às leituras.

## Claims

`defineClaimsSchema({ resources })` aceita:

| Claim | Forma |
|---|---|
| `iss`, `aud`, `exp` | obrigatórias; `aud` é texto ou lista |
| `nbf`, `sub`, `azp` | opcionais |
| `roles` | lista de textos |
| `accessRights` | recurso → lista de `create`, `read`, `update`, `delete`, `discover` |
| `predefinedFilters` | recurso → atributo → texto |

Os recursos de `accessRights` e `predefinedFilters` precisam estar em `resources`; um recurso fora da lista recusa o token. Claims que o módulo não declarou passam sem validação. O kit entrega `predefinedFilters` como valor; aplicá-lo é do módulo.

## Chamar outro módulo

```ts
import { createCachingTokenSource, createClientCredentialsTokenSource } from 'identity-kit/client';

const tokens = createCachingTokenSource(
  createClientCredentialsTokenSource({
    tokenEndpointUrl: config.tokenEndpointUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    audience: config.targetAudience,
  }),
  { now: () => new Date() },
);

const result = await tokens.obtainAccessToken();
if (!result.obtained) throw new Error('no access token'); // o módulo decide o que fazer
// ... chamar com `Authorization: Bearer ${result.accessToken}`
// se o destino recusar o token:
tokens.reportAccessTokenRefused(result.accessToken);
```

Toda falha vira `{ obtained: false }`; nada é lançado e nada é escrito em log. O token fica em cache até 30 segundos antes do vencimento.

## Testar

```ts
import { createTestIssuer } from 'identity-kit/testing';

const issuer = await createTestIssuer();            // servidor em loopback
const claims = issuer.claims('audience-do-modulo', { accessRights: { productOrder: ['read'] } });
const token = issuer.issue(claims);                 // assinado pela chave publicada
const forged = issuer.issueForeign(claims);         // mesma `kid`, chave que o emissor não publica
issuer.rotateKey({ retireCurrent: true });          // troca de chave
await issuer.close();
```

### Emissor em outro container

Para o emissor rodar como serviço do `docker compose` (por exemplo, a imagem de um módulo que já traz o kit), passe o endereço de escuta e a URL pública. Uma linha basta:

```ts
const issuer = await createTestIssuer({
  host: '0.0.0.0',                     // padrão: 127.0.0.1
  port: 8080,                          // padrão: porta efêmera
  publicUrl: 'http://test-issuer:8080', // é o `iss`, o `issuer` do discovery; o `jwks_uri` deriva dela
  issuanceRoute: true,                 // padrão: desligada
});
```

Com `issuanceRoute: true`, o emissor responde `POST /issue` com `{ "audience": "...", "subject": "...", "roles": ["..."] }` (só `audience` é obrigatório) e devolve `{ "token": "..." }`, assinado pela chave que ele publica em `/keys`. Corpo inválido responde 400. **A rota emite token para qualquer pedido: use só em ambiente de teste.** O kit não tem trava contra produção; a variável `NODE_ENV` não é lida.

Use `issuer.url` como emissor do verificador. Para os casos de recusa, `identity-kit/testing` também traz `unsignedToken`, `hmacToken`, `signToken` com chave própria e `tokenWithSegments`.

## Desenvolvimento

```
export PATH=~/.nvm/versions/node/v24.22.1/bin:$PATH
pnpm install
pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm duplication
```

Regra do projeto: teste antes do código. Toda recusa tem o seu teste.

## Versões

Semver. Antes da `1.0.0` uma versão menor pode quebrar a interface; o `CHANGELOG.md` diz o que mudou. Para publicar: `pnpm release X.Y.Z` (cria o commit com `dist` e a tag; o envio ao servidor é manual).
