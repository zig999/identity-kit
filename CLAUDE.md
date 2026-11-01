# identity-kit: limites e escopo

Este arquivo limita o que o identity-kit é, possui e faz. Quando um pedido conflitar com ele, aponte o conflito antes de implementar qualquer coisa.

Regras gerais dos módulos de vendas: `../CLAUDE.md`. Este arquivo vale só para o identity-kit. O escopo detalhado, a interface pública e as fases de construção estão em `PLANO.md`.

## 1. Propósito

O identity-kit é uma **biblioteca** TypeScript, não um serviço. Não tem API HTTP, banco, migração nem regra de negócio de venda. Ela dá a todos os módulos de vendas a mesma maneira de lidar com identidade, em três capacidades:

- **Verificar** quem chama: ler o token Bearer, validar o JWT e entregar as claims ao módulo.
- **Obter** o token para chamar outro módulo: client credentials, com cache e renovação.
- **Testar** as duas coisas: um emissor OIDC de teste e um endpoint de token de teste.

> **Regra central:** o kit autentica, o módulo autoriza. O kit diz quem é o chamador e o que o token afirma. Qual direito cada operação exige, e o que fazer sem ele, é decisão do módulo.

O kit não usa Siegard. A prova do que ele faz está nos testes, que são escritos antes do código.

## 2. Regra de decisão

Uma funcionalidade pertence ao identity-kit só quando a sua responsabilidade principal é responder a uma destas perguntas:

- **Verificação:** Este texto é um token Bearer bem formado? A assinatura confere com as chaves do emissor? O emissor, a audiência e a validade estão corretos? Quais claims ele carrega?
- **Chaves:** De onde vêm as chaves do emissor? Por quanto tempo valem, quando recarregar, o que fazer quando a chave troca ou o emissor não responde?
- **Cliente:** Como este módulo obtém um token para chamar outro? Quando renovar? O que fazer quando o token é recusado?
- **Claims:** Qual é o formato comum das claims que todos os módulos entendem?
- **Teste:** Como um teste obtém um emissor e tokens válidos, expirados ou forjados, sem rede externa?

Se a funcionalidade responde principalmente a uma pergunta abaixo, ela **não** pertence a este kit:

| Pergunta | Onde mora |
|---|---|
| Este chamador pode executar esta operação neste recurso? | O módulo que expõe a operação |
| Quais registros este chamador enxerga (`predefinedFilters`)? | O módulo dono do recurso (por exemplo o catálogo) |
| Quem é o usuário, qual é a sua senha, como ele entra? | O provedor OIDC externo |
| Quais direitos e papéis um usuário ou cliente recebe? | O provedor OIDC externo, que os grava no token |
| Quem é a pessoa ou a organização cadastrada? | partymgmt |
| Como cada módulo configura a sua audiência, o emissor e os segredos? | A configuração de cada módulo |
| Como o módulo responde ao chamador quando recusa (corpo do erro)? | O contrato de cada módulo |
| Como autenticar quem recebe um evento publicado (hub)? | Decisão em aberto da seção 7 |

Na dúvida, não pertence. Pare e pergunte.

## 3. O kit é responsável por

### 3.1 Verificação (subcaminho principal)

- Ler o cabeçalho `Authorization: Bearer` com **uma única** regra de leitura, igual para todos os módulos.
- Validar o JWT: assinatura (RS256, RS384, RS512, ES256, ES384, ES512), emissor (`iss`), audiência (`aud`), expiração (`exp`) e início de validade (`nbf`).
- Recusar qualquer outro algoritmo, inclusive `none` e a família HS.
- Devolver as claims validadas ou **nenhum resultado**, sem dizer ao chamador qual verificação falhou. O motivo vai a um callback de log opcional, sem o token.
- Manter o cliente de chaves: descoberta em `<emissor>/.well-known/openid-configuration`, leitura do `jwks_uri`, cache, recarga com intervalo mínimo, uma só leitura para pedidos concorrentes e tolerância à troca de chave.
- Declarar o esquema comum das claims e permitir que cada módulo declare os recursos dele.
- Expor o chamador verificado: sujeito, papéis, se é serviço e se tem um direito sobre um recurso.

### 3.2 Lado cliente (`identity-kit/client`)

- Obter o token por client credentials (RFC 6749, seção 4.4), com cliente e segredo em Basic.
- Manter o token em cache e renová-lo antes do vencimento, sem duas obtenções simultâneas.
- Esquecer o token que o módulo de destino recusou.
- Tratar toda falha como **token não obtido**, nunca como exceção para o módulo.

### 3.3 Teste (`identity-kit/testing`)

- Emissor de teste em loopback: discovery, JWKS, assinatura de tokens com as claims pedidas, rotação de chave.
- Endpoint de token de teste que registra o que recebeu.
- Nenhum teste de módulo monta o seu próprio emissor.

### 3.4 Adaptador Fastify (`identity-kit/fastify`, opcional)

- Hook `onRequest` que autentica e responde 401 sem token ou com token inválido ou expirado. A resposta 403 fica com o módulo.
- `fastify` entra só como peer opcional. O subcaminho principal não conhece nenhum framework HTTP.

## 4. O kit NÃO é responsável por

- **Emitir tokens em produção.** Quem emite é o provedor OIDC externo. O emissor de teste existe só em `identity-kit/testing` e nunca é usado em produção.
- **Decidir autorização.** Nenhum mapa de "operação exige direito" mora aqui.
- **Aplicar filtros de visibilidade.** `predefinedFilters` chega ao módulo como valor; a semântica é do módulo.
- **Guardar usuário, cliente, papel ou sessão.** Não há modelo de usuário.
- **Segredos.** O kit recebe segredo por parâmetro. Não lê `process.env`, arquivo nem cofre.
- **Log próprio.** O kit não escreve em console nem em arquivo. Ele entrega o fato por callback.
- **Trace distribuído.** O kit aceita cabeçalhos extras nas leituras de chaves por injeção, mas não conhece o formato de nenhum trace.
- **Regra de venda.** Catálogo, pedido, cliente, cotação, inventário e os demais domínios não aparecem em nome, tipo ou teste.
- **Importar qualquer módulo de vendas.** A dependência vai só dos módulos para o kit.

### Como aplicar esta fronteira

- Tudo que o kit expõe tem um uso em pelo menos dois módulos. Código usado por um só módulo fica nele.
- O kit não conhece os nomes de recursos de nenhum módulo. Cada módulo injeta os seus.
- Papéis como `catalog-administrator` e `product-order-administrator` são do módulo. O kit só entrega a lista de papéis do token.
- Quando o catálogo e o productorder divergirem sobre um comportamento, o kit segue o contrato público definido em `PLANO.md`, e os dois se adaptam.

## 5. Fronteiras internas

Estas regras valem mesmo dentro de um único pacote:

1. **Verificação não depende do lado cliente**, e o lado cliente não depende da verificação.
2. O subcaminho `testing` pode importar os outros dois. **Nenhum outro importa `testing`.**
3. O adaptador Fastify depende do subcaminho principal, e o principal não conhece o adaptador.
4. **Nenhuma dependência de runtime além de `zod`** e dos módulos nativos do Node. Qualquer outra pede decisão registrada.
5. **Todo caminho de recusa tem um teste** que prova que o token é recusado: assinatura inválida, chave desconhecida, algoritmo proibido, emissor errado, audiência errada, token expirado, token ainda não válido, cabeçalho mal formado, emissor fora do ar.
6. O relógio é injetado (`now()`). Nenhum teste espera um tempo fixo.
7. Erros do kit têm tipo próprio (`KeySetLoadError`). O kit não lança erro de nenhum módulo.
8. A interface pública é a lista de `exports` do `package.json`. Nenhum consumidor importa arquivo interno.
9. O token nunca aparece em mensagem de erro, em log nem em corpo de resposta.

## 6. Regras de implementação

- **Teste antes do código.** Nenhuma mudança no verificador, no cliente de chaves ou no esquema de claims entra sem um teste que a prove. A primeira entrega porta os testes existentes do catálogo e do productorder, e só depois o código.
- **Segurança em primeiro lugar.** Em caso de dúvida, recuse. Um token aceito por engano é um defeito grave; um token recusado por engano é um defeito de disponibilidade. O kit prefere o segundo.
- Siga as RFCs listadas na seção 9. Onde um módulo pedir comportamento diferente, a RFC vale.
- **Stack** igual à do `partymgmt`, sem o que é de serviço: Node 24 (`engines.node >=24`), pnpm, TypeScript estrito, Vitest, oxlint, prettier, secretlint e jscpd. Coloque `~/.nvm/versions/node/v24.22.1/bin` no PATH antes de rodar qualquer comando.
- Regras de código mantidas do `partymgmt`: sem `console`, sem ciclo de import, sem `any`, sem asserção de tipo, sem `process.env`, função com até 30 linhas, até 3 parâmetros, sem número mágico, arquivos em kebab-case.
- **Versão e distribuição:** os módulos instalam o kit por tag git (`github:zig999/identity-kit#vX.Y.Z`). A tag aponta para um commit que traz `dist` compilado, porque o Node não executa TypeScript dentro de `node_modules`. Tags são imutáveis e nunca movidas. Toda tag leva uma entrada no `CHANGELOG.md`. Mudança incompatível exige tag nova.
- Antes de criar função, tipo ou opção pública, cite a RFC ou o uso real em dois módulos que a justifica. Sem fonte, não cria.
- O formato das claims comuns é decidido uma vez e vale para todos. Não crie variantes por módulo dentro do kit.

## 7. Decisões em aberto (confirmar antes de implementar a parte relacionada)

- **Formato comum das claims.** Hoje o catálogo usa `accessRights` por recurso e `predefinedFilters`; o productorder usa só `roles`; o partymgmt não usa nenhuma. Até decidir, o kit segue o formato do catálogo e recebe a lista de recursos de cada módulo.
- **Emissor obrigatório.** A verificação do `iss` é nova em relação ao catálogo. Confirmar que todos os emissores em uso a trazem.
- **Token do usuário ou token do módulo** nas chamadas entre módulos: o kit só obtém o token do módulo (client credentials). Repasse do token do usuário e troca de token (RFC 8693) ficam fora até haver decisão.
- **Adaptador Fastify.** Entra só se mais de um módulo usar o mesmo hook.
- **Eventos publicados (hub).** Como autenticar quem os recebe: token do publicador, assinatura do corpo ou outro mecanismo.
- **Tolerância de relógio** diferente de zero.
- **Registry.** A distribuição por tag git é provisória. Um registry privado pode substituí-la sem mudar o código do kit.

## 8. Dependências entre módulos

- O kit é consumido por todos os módulos de vendas. Nenhum módulo é consumido pelo kit.
- A adoção segue esta ordem: partymgmt, productcatalog, productorder, e depois os módulos novos já nascem com o kit.
- Enquanto o kit não tem uma tag, cada módulo mantém o seu código atual. A troca de cada um é uma mudança do próprio módulo, com a suíte dele passando.

## 9. Documentos de referência

- **RFC 6749:** OAuth 2.0, seção 4.4 (client credentials) e seção 5.1 (resposta de token).
- **RFC 6750:** uso do token Bearer no cabeçalho `Authorization`.
- **RFC 7515 e RFC 7517:** JWS e JWK (assinatura e chaves).
- **RFC 7519:** JWT e as claims registradas (`iss`, `sub`, `aud`, `exp`, `nbf`).
- **RFC 8725:** melhores práticas para JWT (algoritmos, `none`, confusão de chave).
- **RFC 8414 e OpenID Connect Discovery 1.0:** descoberta do emissor e do `jwks_uri`.
- **RFC 8693:** troca de token, só como referência da decisão da seção 7.
- **Código de origem**, nos módulos irmãos:
  - `../productcatalog/backend/src/access/` e `src/clients/jwks-client.ts`: verificador, esquema de claims e cliente de chaves;
  - `../productcatalog/backend/tests/operation/clients/` e `tests/support/`: provas do cliente de chaves e fonte de tokens de teste;
  - `../productorder/backend/src/clients/` e `src/ports/access-token-source.port.ts`: token por client credentials e cache;
  - `../productorder/backend/tests/functional/` e `tests/support/token-endpoint-stand-in.ts`: provas do lado cliente e endpoint de teste.
- **Identidade nos componentes TM Forum** (`../tmforum`, repositório próprio): TMFC020 e TMFC035, com TMF720, TMF672 e TMF691. Servem de contexto. O kit não implementa essas APIs.

## 10. Checklist antes de entregar uma mudança

- [ ] Responde a uma pergunta de verificação, chaves, cliente, claims ou teste da regra de decisão (seção 2)?
- [ ] Nada de autorização, filtro de visibilidade, usuário, segredo, log próprio ou regra de venda entrou no kit?
- [ ] Tem uso em pelo menos dois módulos, ou uma RFC que a justifique?
- [ ] O teste foi escrito antes do código, e cada caminho de recusa novo tem o seu?
- [ ] O token não aparece em erro, log nem resposta?
- [ ] A dependência de runtime continua sendo só `zod`?
- [ ] O kit não importa nenhum módulo de vendas, e `testing` não é importado pelos outros subcaminhos?
- [ ] A interface pública mudou? Então `CHANGELOG.md`, a tag e o plano de atualização dos consumidores estão prontos?
- [ ] Nenhuma decisão em aberto da seção 7 foi tomada em silêncio?
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` e `pnpm exec jscpd src` passam em Node 24?
