# identity-kit: análise e plano de desenvolvimento

Biblioteca TypeScript que todos os módulos de vendas usam para autenticar chamadas: verificar o token Bearer recebido, obter o token para chamar outro módulo e testar ambos com um emissor de teste. Não tem API HTTP, banco nem regra de negócio. Não usa Siegard.

## 1. Escopo

**Entra**
- Leitura do cabeçalho `Authorization: Bearer`.
- Verificação do JWT: assinatura (RS256/384/512, ES256/384/512), `iss`, `aud`, `exp`, `nbf`.
- Cliente JWKS: descoberta em `<emissor>/.well-known/openid-configuration`, cache, recarga com intervalo mínimo, uma só leitura para pedidos concorrentes.
- Esquema comum das claims: `iss`, `aud`, `sub`, `exp`, `roles`, `accessRights`, `predefinedFilters`.
- Fonte de token por client credentials (RFC 6749), com cache e renovação antes do vencimento.
- Emissor OIDC de teste e endpoint de token de teste.
- Adaptador Fastify (fase 6, opcional).

**Não entra**
- Qual direito cada operação exige: cada módulo decide.
- Semântica de `predefinedFilters` (o catálogo a aplica): o kit só entrega o valor.
- Emissão de tokens em produção: é o provedor OIDC externo.
- Cadastro de usuários ou clientes.

## 2. Origem do código

| Peça | Origem | Linhas | Acoplamento a remover |
|---|---|---|---|
| Verificador | `productcatalog/backend/src/access/token-verifier.ts` | 148 | `PublishedApi` (mapa API → audiência); passa a receber a audiência esperada |
| Cliente JWKS | `productcatalog/backend/src/clients/jwks-client.ts`, `types/key-set-source.ts` | 121 | Contexto de trace, `DataError`, `KeySetLoadError`: o kit declara o seu erro e aceita cabeçalhos extras por injeção |
| Claims | `productcatalog/backend/src/access/access-claims.ts` | 33 | Lista fixa de recursos e operações do catálogo |
| Autenticador e chamador | `access/authenticator.ts`, `access/caller.ts` | 22 + ~35 | `ResourceName`, `predefined-filters`, papel `catalog-administrator` |
| Token por client credentials | `productorder/backend/src/clients/client-credentials-access-token-source.client.ts` e `ports/access-token-source.port.ts` | 124 | `ICatalogAccessConfig` |
| Cache e renovação | `productorder/backend/src/clients/caching-access-token-source.client.ts` | ~90 | `IClock` do módulo: o kit recebe `now()` |
| Emissor de teste | `productcatalog/backend/tests/support/source-tokens.ts`, `issuer-fetch-recording.ts`; `productorder/backend/tests/support/token-endpoint-stand-in.ts` | a medir | Unificar |

Total a mover: cerca de 600 a 900 linhas de fonte, sem dependência de runtime além de `zod` e `node:crypto`.

## 3. Mudanças de comportamento em relação ao catálogo

Estas diferenças são deliberadas e entram com teste próprio. Todas precisam ser aceitas pelo catálogo ao migrar.

1. **`iss` é verificado.** Hoje o emissor só define de onde vêm as chaves.
2. **`nbf` é verificado** quando presente.
3. **Tolerância de relógio** configurável, padrão 0 s (igual ao catálogo).
4. **A audiência é argumento da verificação**, e não um mapa interno. O catálogo mantém o mapa API → audiência no código dele.
5. **Recusa uniforme.** O verificador devolve `undefined` em qualquer falha, sem dizer o motivo ao chamador. O motivo vai para um callback opcional de log, sem o token.
6. **Algoritmo `none` e HS\* são recusados**, como hoje (só RS e ES são aceitos).

## 4. Interface pública

Exportada por `exports` do `package.json`, sem acesso a arquivos internos.

| Subcaminho | Conteúdo |
|---|---|
| `identity-kit` | `bearerTokenOf`, `createJwksClient`, `createTokenVerifier`, `createAuthenticator`, `createCaller`, `defineClaimsSchema`, `OPERATION_TYPES`, `KeySetLoadError` |
| `identity-kit/client` | `createClientCredentialsTokenSource`, `createCachingTokenSource`, tipos `IAccessTokenSource` e `AccessTokenResult` |
| `identity-kit/fastify` | Hook `onRequest` que autentica e responde 401, e `request.caller` (fase 6; `fastify` como peer opcional) |
| `identity-kit/testing` | `createTestIssuer` (discovery, JWKS, assinatura de tokens), `createTokenEndpointStandIn` |

**Claims.** `defineClaimsSchema({ resources })` é a única porta de entrada: o módulo sempre declara os seus recursos e passa o esquema ao verificador (`claims`). Não há esquema-base sem recursos. O esquema valida `iss`, `aud`, `sub`, `exp`, `nbf?`, `roles?`, `azp?` e deixa passar claims desconhecidas. Ele devolve o esquema com `accessRights` e `predefinedFilters` restritos à lista de recursos do módulo e ao vocabulário `create`, `read`, `update`, `delete`, `discover`. Isso resolve o ponto em que o esquema do catálogo está preso aos recursos dele.

**Chamador.** `createCaller(claims)` expõe `subject`, `roles`, `claims` e `holds({ resource, type })`. A distinção pessoa ou serviço fica fora até haver decisão. Não aplica filtros.

## 5. Stack

Igual à do `partymgmt`, sem o que é de serviço:

- Node 24 (`engines.node >=24`), pnpm 12.14.0, TypeScript ^7, ESM com `NodeNext`, `strict` e as demais opções do `tsconfig` do `partymgmt`.
- Vitest 5 (projetos `behaviour` e `architecture`), oxlint com `--type-aware --deny-warnings`, prettier (120 colunas, aspas simples), secretlint, jscpd (limiar 0).
- Regras de código do `partymgmt` mantidas: sem `console`, sem ciclo de import, sem `any`, sem `process.env` em `src`, função até 30 linhas, até 3 parâmetros, sem números mágicos, nomes de arquivo em kebab-case.
- Fora: Fastify (exceto o adaptador), `pg`, `node-pg-migrate`, `embedded-postgres`, Swagger, rate-limit, outbox e as regras de módulos de domínio.
- `zod` é a única dependência de runtime.

Já criados nesta pasta: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.oxlintrc.json`, `.prettierrc.json`, `.jscpd.json`, `.secretlintrc.json`, ignores e `.gitignore`. `pnpm install` ainda não foi rodado.

## 6. Distribuição por tag git

Os módulos declaram `"identity-kit": "github:zig999/identity-kit#v<x.y.z>"`.

**Risco:** o Node 24 não executa TypeScript dentro de `node_modules`, então o consumidor precisa receber JavaScript compilado. O `partymgmt` usa `strictDepBuilds: true`, que bloqueia scripts de build de dependências. Duas saídas:

- **A. `dist` versionado só no commit da tag.** O script de release compila, faz commit de `dist` num commit de release e cria a tag nesse commit. O consumidor não executa build. É robusto e é o que recomendo.
- **B. `prepare` com `allowBuilds` em cada consumidor.** Exige configuração em todo módulo e depende do comportamento do pnpm 12 com dependência git.

A fase 0 valida a saída A com um consumidor descartável antes de qualquer código.

**Regras de versão**
- Semver. Tag nunca é movida nem apagada.
- `0.x` até haver três consumidores em uso; a partir daí `1.0.0`.
- `CHANGELOG.md` obrigatório por tag. Mudança incompatível exige tag nova e atualização planejada dos consumidores.

## 7. Plano em fases

Cada fase termina com `typecheck`, `lint`, `format`, `test` e `jscpd` verdes.

**Fase 0: base e distribuição**
- `pnpm install`, rodar as cinco verificações vazias.
- Teste de arquitetura de configuração (equivalente ao `project-configuration.test.ts` do `partymgmt`): `engines`, scripts, ausência de dependência proibida.
- Script de release (compila, commita `dist`, cria a tag).
- Consumidor descartável instala `v0.0.1` com `pnpm` e as mesmas travas do `partymgmt`.
- **Pronto quando:** o consumidor instala por tag e importa `identity-kit` em Node 24.

**Fase 1: provas primeiro (testes escritos, vermelhos; ver resultado abaixo)**
- Inventariar no catálogo todos os testes que exercitam verificador, JWKS e claims (os sete `jwks-client-*` em `tests/operation/clients/` e os que usam `source-tokens.ts`).
- Portar esses testes para o kit, ainda falhando.
- **Pronto quando:** a lista de comportamentos exigidos está em testes vermelhos, um por propriedade (cache, intervalo mínimo, coalescência, troca de chave, audiência, expiração, algoritmo recusado).

**Fase 2: verificação (concluída)**
- Cliente JWKS e verificador, sem trace e sem `DataError`.
- `bearerTokenOf` único, com a regra mais estrita (base64url).
- Comportamentos novos: `iss`, `nbf`, tolerância de relógio, callback de motivo.
- **Pronto quando:** os testes da fase 1 passam e os novos também.

**Resultado.** 246 testes passam (239 de comportamento e 7 de arquitetura, mais os 6 de configuração já contados entre eles). Uma verificação por mutação (18 alterações deliberadas no código) mostrou que cada uma é detectada por pelo menos um teste; uma delas (algoritmo em outra caixa) só foi detectada depois de acrescentar um teste com chave sem `alg`.

**Fase 3: claims e chamador**
- `baseClaimsSchema`, `defineClaimsSchema`, `createCaller`, `createAuthenticator`.
- Depende da decisão sobre o formato comum das claims. Se ela atrasar, segue com o formato do catálogo estendido e uma lista de recursos injetável.
- **Pronto quando:** um módulo de exemplo nos testes define seus recursos e o esquema recusa recurso fora da lista.

**Fase 4: lado cliente (concluída)**
- Token por client credentials e cache com renovação, portados do `productorder` com os testes (`client-credentials-access-token-source.spec.ts`, `caching-access-token-source.spec.ts`, `access-token-source.spec.ts`).
- **Pronto quando:** os testes portados passam sem `ICatalogAccessConfig`.

**Fase 5: emissor de teste**
- `createTestIssuer` (par de chaves ES256 em memória, discovery e JWKS em loopback, assinatura de tokens com claims dadas, rotação de chave) e `createTokenEndpointStandIn`.
- Os testes das fases 2 e 4 passam a usá-lo.
- **Pronto quando:** nenhum teste do kit monta emissor próprio.

**Fase 6: adaptador Fastify (opcional)**
- Hook `onRequest`, 401 sem token, token inválido ou expirado; 403 fica com o módulo.
- Só entra se `partymgmt` e `productorder` quiserem o mesmo hook. Caso contrário, cada módulo escreve o seu em 10 linhas.

**Fase 7: versão 0.1.0 e adoção**
- `README.md` com a API pública, o formato de claims e a política de versão; `CHANGELOG.md`; tag `v0.1.0`.
- Ordem de adoção:
  1. `partymgmt`: passa a verificar o token (hoje só confere a presença).
  2. `productcatalog`: troca o código local pelo kit; a suíte atual passa sem alteração além dos imports e do mapa de audiências.
  3. `productorder`: troca o leitor por cabeçalhos pelo kit e a fonte de token; exige `/analyse` no Siegard dele.
- **Pronto quando:** a suíte do catálogo passa usando o kit e o `partymgmt` recusa token com assinatura inválida.

## 8. Riscos

| Risco | Efeito | Tratamento |
|---|---|---|
| Erro no verificador | Token falso aceito | Fase 1 antes do código; teste de recusa para cada falha; nenhuma mudança sem teste |
| Dependência git bloqueada pelas travas do pnpm | Módulos não instalam | Fase 0 prova a instalação; saída A (`dist` na tag) |
| Esquema de claims preso ao catálogo | Outros módulos não conseguem definir recursos | `defineClaimsSchema` com lista injetável (fase 3) |
| Mudança de comportamento (`iss`, `nbf`) quebra o catálogo | Falha na migração | Tokens de teste do catálogo conferidos na fase 7; tag `0.x` permite ajustar |
| Quebra de versão propagada | Nove módulos quebrados | Tags imutáveis, `CHANGELOG`, atualização planejada |
| Relógio e chaves em testes | Testes instáveis | `now()` injetado e sem esperas fixas (regra de lint) |

## 9. Decisões pendentes

- Formato comum de `accessRights` e papéis (fase 3).
- Se o kit expõe adaptador Fastify (fase 6).
- Se `iss` obrigatório vale para todos os emissores em uso.
