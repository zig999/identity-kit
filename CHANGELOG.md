# Changelog

## 0.2.0

Emissor de teste alcançável por outro container. Tudo é novo e opcional: sem as opções, o comportamento é o da 0.1.0.

- `createTestIssuer` aceita `host` e `port` (padrão: `127.0.0.1` e porta efêmera).
- `createTestIssuer` aceita `publicUrl`: é o `iss` das claims geradas e o `issuer` do discovery, e o `jwks_uri` deriva dela, independente do endereço de escuta. `issuer.url` devolve a URL pública.
- `createTestIssuer` aceita `issuanceRoute: true`, que liga `POST /issue` (`audience`, `subject?`, `roles?`) e devolve `{ token }` assinado pela chave publicada em `/keys`. Desligada por padrão. Sem trava contra produção; a rota é só para teste.
- Pedido de origem: `CR-test-issuer-alcancavel-por-outro-container.md` (productorder).

## 0.1.0

Primeira versão utilizável.

- Verificação de token Bearer (JWT): assinatura RS256/384/512 e ES256/384/512, `iss`, `aud`, `exp`, `nbf`, tolerância de relógio opcional e callback com o motivo da recusa.
- Cliente JWKS com descoberta OIDC, cache de 10 minutos, recarga mínima de 30 segundos e uma só leitura para pedidos concorrentes.
- `defineClaimsSchema` com os recursos declarados pelo módulo; `createCaller` e `createAuthenticator`.
- Token por client credentials (`identity-kit/client`) com cache e renovação 30 segundos antes do vencimento.
- Emissor OIDC de teste e endpoint de token de teste (`identity-kit/testing`).

Diferenças em relação ao verificador que existia no `productcatalog`: o emissor (`iss`) e o início de validade (`nbf`) passam a ser verificados; a audiência esperada é um argumento da verificação.
