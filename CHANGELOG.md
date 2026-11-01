# Changelog

## 0.1.0

Primeira versão utilizável.

- Verificação de token Bearer (JWT): assinatura RS256/384/512 e ES256/384/512, `iss`, `aud`, `exp`, `nbf`, tolerância de relógio opcional e callback com o motivo da recusa.
- Cliente JWKS com descoberta OIDC, cache de 10 minutos, recarga mínima de 30 segundos e uma só leitura para pedidos concorrentes.
- `defineClaimsSchema` com os recursos declarados pelo módulo; `createCaller` e `createAuthenticator`.
- Token por client credentials (`identity-kit/client`) com cache e renovação 30 segundos antes do vencimento.
- Emissor OIDC de teste e endpoint de token de teste (`identity-kit/testing`).

Diferenças em relação ao verificador que existia no `productcatalog`: o emissor (`iss`) e o início de validade (`nbf`) passam a ser verificados; a audiência esperada é um argumento da verificação.
