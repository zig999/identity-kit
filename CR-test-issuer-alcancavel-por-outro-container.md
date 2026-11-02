# Change request: emissor de teste alcançável por outro container

Pedido de: productorder (`~/projects/sales/productorder`), iniciativa `bearer-token-caller-identity`.
Data: 2026-11-02 (revisado no mesmo dia, depois da análise da sessão do kit).
Destino: o identity-kit, para tratamento em sessão própria neste projeto. Este documento não altera nada no kit.

## Resumo

O `createTestIssuer` do entry point `identity-kit/testing` só serve quem está no mesmo processo e no mesmo host: escuta em `127.0.0.1`, numa porta efêmera, e o `iss` é sempre `http://127.0.0.1:<porta aleatória>`. O deployment de conformidade do productorder roda o módulo num container e precisa do emissor de teste em outro, como serviço do `docker compose`.

Pede-se uma nova versão (sugestão: v0.2.0) em que `createTestIssuer` aceite host, porta e URL pública, e ofereça, como opção explícita, uma rota que emite token sob demanda. O kit continua sendo só biblioteca: **este pedido não inclui executável, `bin`, serviço nem pacote novo.**

## Por que só isso basta

O serviço do emissor no compose do productorder será a imagem do próprio módulo, que já traz `identity-kit` como dependência de produção e, com ele, `dist/testing`. O comando do serviço é uma linha, chamando `createTestIssuer` com as opções pedidas aqui. Não existe arquivo novo no módulo, repositório novo nem executável. O mesmo vale para qualquer outro módulo ou para o salese2e: um serviço do compose com a imagem de um módulo e a mesma linha.

Isso respeita as constraints da especificação do productorder: o código do módulo não importa `identity-kit/testing`, não assina token, e o deployment de conformidade verifica contra o emissor de teste do kit declarado como serviço no compose, sem emitir token por conta própria. A assinatura fica dentro do kit.

## O problema, com a evidência

Em `src/testing/test-issuer.ts` (v0.1.0):

- `const LOOPBACK = '127.0.0.1'` e `const EPHEMERAL_PORT = 0`; o servidor faz `server.listen(EPHEMERAL_PORT, LOOPBACK, ...)`. Um container vizinho não alcança um socket preso ao loopback de outro container.
- A URL do emissor é montada depois do `listen`, a partir da porta sorteada. As claims de `claims(audience)` levam `iss: url`, e o discovery document devolve `issuer: url` e `jwks_uri: url + '/keys'`. O `iss` muda a cada execução e não dá para escrevê-lo em `AUTH_ISSUER` antes de o emissor subir.
- `ITestIssuerOptions` só tem `alg`, `now` e `lifetimeSeconds`: não há host, porta nem URL pública.
- O HTTP serve só `/.well-known/openid-configuration` e `/keys`. Emitir token é a chamada em processo `issue(claims)`; não há rota de emissão. Um chamador em outro container não tem como pedir um token.

`token-endpoint-stand-in.ts` tem o mesmo padrão de loopback, mas é outro papel (o endpoint de token que o módulo chama para obter token de saída) e não faz parte deste pedido.

## O que se pede

Cada item é um requisito observável. O desenho (nomes das opções, forma da rota) fica para a sessão do kit.

1. **Host e porta configuráveis.** `createTestIssuer` aceita o host de escuta e a porta. O padrão continua `127.0.0.1` e porta efêmera.
2. **`iss` fixo e independente do bind.** Uma opção de URL pública (por exemplo `http://test-issuer:8080`). Quando informada, ela é o `iss` das claims geradas e o `issuer` do discovery document, e `jwks_uri` é derivado dela. Escutar em `0.0.0.0:8080` e anunciar `http://test-issuer:8080` tem de funcionar.
3. **Token sob demanda por HTTP, opcional.** Uma rota do emissor, desligada por padrão e ligada por opção explícita, que emite um token assinado pelas chaves que o próprio emissor publica, para a audiência e o sujeito pedidos, com os papéis (claim `roles`) pedidos e a validade padrão. O `iss` do token é o do item 2 e a `aud` é a pedida. Um chamador de teste em outro container (a bateria do CTK, por exemplo) obtém o token por essa rota.
4. **Chaves coerentes.** As chaves publicadas em `/keys` são as que assinam os tokens emitidos. Não se exigem chaves fixas entre execuções.
5. **Compatibilidade.** Quem usa o v0.1.0 hoje continua funcionando sem mudança: tudo o que é novo é opcional.
6. **Nova tag, `CHANGELOG.md` e `files`.** Publicar a versão com a tag, e garantir que o pacote publicado traga `dist/testing` (o consumidor o usa dentro de uma imagem instalada com `--prod`).

## Pontos para a sessão do kit decidir

- **Forma da rota de emissão.** Uma rota própria do emissor, ou um token endpoint de client credentials que responde com um JWT assinado por ele. O requisito é só o do item 3.
- **Trava contra produção.** Com a rota ligada, o emissor emite token para qualquer pedido. A sessão do kit decide se `createTestIssuer` recusa subir quando `NODE_ENV=production`. Atenção: a imagem do productorder define `NODE_ENV=production`, então, se a trava existir, o serviço do compose sobrescreve essa variável (o que é aceitável: é um serviço de teste declarado no compose de conformidade). Se a sessão do kit preferir não ter a trava, basta documentar.
- **Escopo do kit.** Tudo aqui continua no entry point `testing`, que já abre um servidor HTTP em processo, e responde à pergunta do `CLAUDE.md` do kit: "como um teste obtém um emissor e tokens válidos, sem rede externa". Se a sessão do kit concluir que algum item sai do escopo, o item 3 é o único que pode ser discutido; os itens 1 e 2 são indispensáveis.

## Como o productorder vai consumir

1. Re-fixar `identity-kit` na nova tag no `package.json` do módulo.
2. Declarar no `compose.yaml` um serviço `test-issuer` com a imagem do módulo e um comando de uma linha que chama `createTestIssuer` (host `0.0.0.0`, porta e URL pública do serviço, rota de emissão ligada), e apontar `AUTH_ISSUER` do `api-kit` para essa URL pública.
3. Fazer a bateria de conformidade obter seus tokens pela rota do item 3.

O productorder não copia código do kit, não aponta build context para este repositório e não cria arquivo novo para o emissor.

## Critério de aceite

- Subir o emissor com escuta em `0.0.0.0` e URL pública `http://<serviço>:<porta>`, e de um segundo container da mesma rede: ler o discovery document, ler `/keys` e obter um token pela rota de emissão.
- O `iss` do token emitido é igual ao `issuer` do discovery document e igual à URL pública configurada.
- Um módulo que use `createCallerTokenVerifier` do kit, configurado com esse emissor e com a audiência pedida, verifica o token; um token de outro emissor é recusado.
- Sem as novas opções, o comportamento é o do v0.1.0, e os testes existentes passam sem alteração.
- A mudança está no `CHANGELOG.md` e a tag nova está publicada, com `dist/testing` no pacote.

## Estado no lado do productorder

A tarefa `task/deployment-token-verification/conformance-kit-deployment-runs-a-test-issuer` está parada por esta limitação. As outras três tarefas da iniciativa (gate de autenticação, identidade do chamador vinda do token, arquivos de produção com `AUTH_ISSUER` e `AUTH_AUDIENCE`) estão entregues e commitadas. Quando o kit publicar a versão, a tarefa retoma sem mudar a especificação do módulo.
