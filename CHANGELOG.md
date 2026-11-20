# Changelog

## 0.3.0

Token de conformidade para o CTK. Sem chamar as funções novas, o comportamento é o da 0.2.0, com uma correção em `createTestIssuer` (abaixo).

- `issueConformanceToken(issuer, audience, { resources?, operations? })` (`identity-kit/testing`) devolve `{ bearerToken, expiresAt }`: o token com o prefixo `Bearer ` e o `exp` como `Date`. Cada recurso informado recebe todas as `OPERATION_TYPES`, ou as `operations` passadas. O kit não inventa recurso: sem `resources`, nenhum direito é concedido.
- `writeEnvSettings(path, settings)` (`identity-kit/testing`) grava variáveis num arquivo de ambiente: cria o arquivo com modo `0600` e não muda o modo de um arquivo existente; troca só as linhas dos nomes recebidos, mantendo o recuo e o prefixo `export` de cada uma, acrescenta as que faltam e preserva as demais. Mantém o fim de linha do arquivo (LF ou CRLF). Recusa nome inválido e valor com quebra de linha antes de tocar no arquivo, e não devolve nem registra os valores.
- Nenhuma das duas escreve em console ou log. O kit não registra tratador de SIGINT nem SIGTERM: o módulo liga os sinais ao `close()` do emissor. `createTestIssuer` mantém loopback, porta efêmera e validade padrão de 3600 segundos.
- Correção em `createTestIssuer`: o `exp` das claims geradas passa a ser inteiro (segundos do relógio arredondados para baixo, mais a validade). Antes podia ser fracionário, e bibliotecas JWT estritas do CTK ou do módulo podiam recusá-lo.
- Erros das funções novas são do tipo `TestSupportError` (exportado de `identity-kit/testing`), sem o token nem o valor na mensagem.
- Divergência do `CLAUDE.md`: `writeEnvSettings` não responde a nenhuma pergunta da regra de decisão (seção 2), e o uso real é de um módulo só (seção 4). Foi aceita por decisão do usuário em 2026-11-20 e registrada na seção 3.3. O segundo uso de `issueConformanceToken` é previsto (padrão de conformidade, CNF-14), não existente.
- Pedido de origem: `CR-token-de-conformidade-para-o-ctk.md` (coordenação dos módulos de vendas).

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
