# Change request: token de conformidade para o CTK, igual em todos os módulos

Pedido de: coordenação dos módulos de vendas (`~/projects/sales`), a partir do padrão `padrao-conformidade-tmforum.md` (CNF-04, seção "Token do CTK").
Data: 2026-11-20.
Destino: o identity-kit, para tratamento em sessão própria neste projeto. Este documento não altera nada no kit.

## Resumo

Todo módulo que roda o CTK do TM Forum precisa de um token Bearer válido para o módulo sob teste, e o único emissor aceito é o de teste do `identity-kit/testing`. Hoje cada módulo monta esse token à mão, com a mesma lógica repetida: as `accessRights` com todas as operações, o prefixo `Bearer`, o instante de validade e a gravação das variáveis no `.env`.

Pede-se que o entry point `testing` ofereça essas peças genéricas, para que cada módulo as chame em vez de reescrevê-las. O kit continua sendo só biblioteca: **este pedido não inclui executável, `bin`, serviço nem pacote novo.** O desenho (nomes, assinaturas) fica para a sessão do kit; abaixo estão só os requisitos observáveis.

## Quem precisa, e a evidência

O inventory escreve a lógica no código do módulo, em `inventory/backend/src/conformance/`:

- `issued-token.ts`: monta `claims(audience, { accessRights })` com um conjunto de recursos e todas as operações (`OPERATION_TYPES`), assina com `issuer.issue`, devolve `Bearer <token>` e o instante de expiração lido de `exp`.
- `env-file-settings.ts`: grava no arquivo de ambiente os três valores do CTK, preservando as outras linhas e criando o arquivo com modo `0600`, e recusa valor com quebra de linha.
- `issue-test-token.ts`: sobe `createTestIssuer` em loopback, usa as duas peças acima, imprime só nomes e a validade, e fica de pé até SIGINT ou SIGTERM.

O productorder já usa a v0.2.0 com `createTestIssuer({ host, port, publicUrl, issuanceRoute: true })` num serviço do compose, e o CTK pede o token pela rota `POST /issue`. Isso atende o modo compose; este pedido não o altera.

**Uso em dois módulos (regra da seção 4 do `CLAUDE.md` do kit).** Hoje só o inventory tem essa lógica no código. O productorder não precisa das peças, porque pede o token pela rota `/issue` do compose. O segundo uso é previsto, não existente: o padrão de conformidade (seção 8) obriga os demais módulos a ter `pnpm conformance`, e o `productcatalog` já roda o CTK da TMF620. A sessão do kit decide se isso basta como justificativa ou se espera o segundo módulo ter a lógica escrita. Se esperar, este pedido fica parado até lá; o inventory mantém o código dele.

O inventory, hoje, importa `identity-kit/testing` em código que vai para o build (`src/conformance/`), o que a especificação do productorder proíbe para o código do módulo fora de testes. Com as peças no kit, o módulo as chama a partir de `scripts/` ou de suporte de teste, fora de `src/`.

## O que se pede

Cada item é um requisito observável.

1. **Token Bearer de conformidade.** Uma função em `identity-kit/testing` que, dado um emissor de teste, uma audiência e os recursos do `accessRights`, devolve o token já com o prefixo `Bearer ` e o instante de expiração (`exp`) como `Date`. Sem os recursos informados, o kit não inventa nenhum nome de recurso: quem chama os declara. Todas as operações de `OPERATION_TYPES` são concedidas para cada recurso informado, a menos que quem chama passe outras.
2. **Gravação de variáveis de ambiente.** Uma função em `identity-kit/testing` que recebe um caminho de arquivo e pares nome/valor e:
   - cria o arquivo com modo `0600` se não existir e não relaxa o modo se existir;
   - substitui só as linhas dos nomes recebidos (inclusive com prefixo `export`) e acrescenta as que faltam, sem tocar nas demais linhas;
   - recusa valor com quebra de linha, sem gravar nada;
   - nunca devolve nem registra os valores gravados.
3. **Valor secreto fora da saída.** Nenhuma das funções do pedido escreve em console, log ou arquivo além do indicado no item 2. O que há para mostrar (nomes e validade) é devolvido a quem chamou, que decide imprimir.
4. **Loopback por padrão.** Quem usa as funções com `createTestIssuer` sem opções continua com `127.0.0.1` e porta efêmera, como na v0.2.0.
5. **Emissor de pé até ser fechado.** O emissor continua sendo fechado por `close()`, chamado por quem o criou. O kit não registra tratador de SIGINT nem SIGTERM; o módulo liga os sinais ao `close()`.
6. **Compatibilidade.** Tudo o que é novo é opcional e aditivo. Quem usa a v0.2.0 hoje continua funcionando sem mudança.
7. **Nova tag, `CHANGELOG.md` e `files`.** Publicar a versão (sugestão: v0.3.0) com tag e entrada no `CHANGELOG.md`, e garantir que o pacote traga `dist/testing`.

## Conflitos com o `CLAUDE.md` do kit, e como o pedido os evita

- **Escopo.** A seção 3.3 do `CLAUDE.md` do kit já cobre "como um teste obtém um emissor e tokens válidos". Os itens 1 e 2 estendem isso ao CTK, que roda fora do vitest. Se a sessão do kit concluir que o item 2 (gravar arquivo) sai do escopo, os itens 1, 3 e 5 ainda valem sozinhos e o módulo mantém só a gravação.
- **Segredos.** A seção 4 diz que o kit "não lê `process.env`, arquivo nem cofre" e que o segredo entra por parâmetro. O item 2 grava, não lê segredo de arquivo: o caminho e os valores entram por parâmetro. A leitura do arquivo existente serve só para preservar as outras linhas.
- **Log e console.** A seção 4 proíbe log próprio. O item 3 mantém o kit sem saída.
- **Sinais.** O item 5 evita que a biblioteca registre tratador de sinal de processo.

## Pontos para a sessão do kit decidir

- **Nomes e assinaturas** das duas funções, e se a primeira recebe o emissor ou o cria.
- **Nome das variáveis gravadas.** O kit não conhece os nomes de variável de nenhum módulo: o padrão pede `AUTH_ISSUER`, a variável de audiência do módulo e `CONFORMANCE_ACCESS_TOKEN`, mas quem passa os pares é o módulo.
- **Validade padrão.** Hoje o emissor de teste usa `lifetimeSeconds`; o inventory passa 7200 por padrão, e a última execução usou 21600. O kit decide se mantém o padrão atual do `createTestIssuer`.
- **Trava contra produção da rota `/issue`.** Continua como decidido na v0.2.0.

## Como os módulos vão consumir

1. Re-fixar `identity-kit` na nova tag nos módulos que rodam o CTK: inventory e productorder, e depois o productcatalog, que hoje está na v0.1.0 e passa direto para a nova tag.
2. Inventory: trocar `issued-token.ts` e `env-file-settings.ts` pelas funções do kit e tirar `identity-kit/testing` de `src/`.
3. Productorder: o serviço `kit-issuer` do compose continua como está; se o kit oferecer o item 1 também para a rota, a troca é opcional.
4. Os módulos não copiam código do kit, não apontam build context para este repositório e não criam emissor próprio.

## Critério de aceite

- Com um emissor em loopback, a função do item 1, chamada com uma audiência e dois recursos, devolve uma string que começa com `Bearer ` e uma expiração igual ao `exp` do token. Um módulo com `createCallerTokenVerifier` configurado com esse emissor e a audiência verifica o token e vê os dois recursos com todas as operações.
- Chamada sem recursos, a função não concede nenhum recurso.
- A função do item 2, sobre um arquivo inexistente, cria o arquivo com modo `0600` e as linhas pedidas. Sobre um arquivo com outras linhas e com uma das variáveis já presente, troca só a linha da variável e preserva as outras na mesma ordem. Com valor que contém quebra de linha, lança erro e o arquivo fica como estava.
- Em nenhum dos casos acima o token aparece em console, log ou mensagem de erro.
- Sem as novas funções chamadas, o comportamento é o da v0.2.0, e os testes existentes passam sem alteração.
- O pacote publicado traz `dist/testing` com as duas funções, e o `CHANGELOG.md` registra a versão.
