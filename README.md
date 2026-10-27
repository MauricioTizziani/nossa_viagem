# Nossas Viagens

Organizador privado de viagens a dois, com Next.js, React, TypeScript, Supabase, Photon/OpenStreetMap e PWA. A entrada geral (`/` ou `/viagens`) abre **Minhas viagens**. Cada viagem tem seu próprio cronograma, gastos, orçamento e histórico. Não há tela de login e senha: uma sessão anônima identifica cada navegador, e convites privados autorizam outros aparelhos.

## Executar

Requisitos: Node.js 22 ou 24, npm e um projeto Supabase. Configure as variáveis públicas de `.env.example` em `.env.local`, habilite **Anonymous Sign-Ins** no Supabase e execute:

```powershell
npm install
npm run dev
```

Abra `http://localhost:3000`. Sem Supabase configurado, a lista começa vazia e mostra as instruções de configuração. Nenhum destino, nome de pessoa, data ou lançamento é inventado.

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública; nunca uma chave administrativa. |
| `NEXT_PUBLIC_PHOTON_URL` | Servidor Photon HTTPS opcional; padrão `https://photon.komoot.io/api/`. |
| `NEXT_PUBLIC_APP_URL` | Endereço final da aplicação. |

Variáveis públicas entram no navegador. Segredos administrativos ficam exclusivamente no ambiente local do proprietário, fora do repositório.

## Atualização do banco e preservação dos dados

Faça uma cópia de segurança do banco antes de aplicar migrações em produção. Em uma instalação nova, aplique todas as migrações de `supabase/migrations/` na ordem dos nomes. Se o banco já chegou a `202610080006_multiplas_viagens.sql`, aplique as migrações posteriores ainda pendentes, em ordem. Para banco atualizado até `202610120001_observacao_atividade.sql`, aplique:

**`202610120002_reparar_tipo_atividade.sql`**

Depois, aplique também:

**`202610120003_convite_todas_viagens.sql`**

Essa migração reestabelece a validação do banco com os tipos usados pelo formulário: `Refeição`, `Lazer` e `Atividade`. Ela não altera atividades existentes; se encontrar um tipo antigo diferente desses valores, interrompe sem modificar os dados para permitir revisão.

Essa migração preserva os identificadores, períodos, valores, atividades, gastos, lugares, vínculos e membros existentes. Cada viagem antiga recebe uma coleção privada. Todas as autorizações antigas, inclusive de proprietários, continuam restritas às viagens que já podiam acessar. O acesso à coleção exige uma autorização explícita; convites antigos de proprietário também não ampliam esse escopo. Uma reexecução não duplica registros nem promove convites de uma viagem para toda a coleção.

A migração encerra o acesso automático de qualquer visitante do modelo 003. Os aparelhos com autorizações já concedidas continuam vendo suas viagens. O endereço do aplicativo e o ID da viagem, sozinhos, não autorizam acesso. Não reaplique a migração histórica 003 depois de 006.

A migração de compartilhamento cria convites privados para todas as viagens pertencentes à identidade atual e às viagens futuras criadas por ela, inclusive em outras coleções. Cada convite autoriza um aparelho e não concede propriedade. O token é armazenado somente como hash, e as tabelas de convites e membros não podem ser consultadas diretamente pelos aparelhos.

**`202610120004_reparar_acesso_convite_site.sql`**

Depois de `202610120003_convite_todas_viagens.sql`, aplique esta atualização para registrar o acesso compartilhado nas associações de cada viagem. Ela também recupera automaticamente convites já aceitos, sem exigir que a pessoa gere um novo link. Viagens criadas depois do convite recebem a mesma associação automaticamente.

**`202610120005_excluir_viagem.sql`**

Esta migração habilita a exclusão permanente de uma viagem. A exclusão remove cronograma, gastos, convites e vínculos daquela viagem em cascata, mas preserva a coleção para outras viagens.

**`202610120006_acoes_viagem_participantes.sql`**

Esta atualização permite que qualquer pessoa autorizada a acessar uma viagem também possa compartilhar ou excluir essa viagem. Participantes podem criar convites somente para essa viagem, sem conceder propriedade, e podem desativar apenas os convites que criaram. Responsáveis continuam podendo administrar todos os convites da viagem.

**`202610120007_excluir_viagem_compartilhada.sql`**

Esta atualização corrige a exclusão de viagens antigas que ainda são referenciadas pelo vínculo interno do compartilhamento anterior. Ao excluir uma dessas viagens, o vínculo obsoleto também é removido.

Para recuperar o acesso a uma viagem antiga ou autorizar explicitamente sua coleção no modelo novo, utilize **a viagem existente**, sem criar uma cópia. Configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ou a chave legada `SUPABASE_SERVICE_ROLE_KEY`) e `APP_URL` em um arquivo local `.env.owner`. Para recuperar apenas a viagem:

```powershell
npm run provision -- --trip UUID_DA_VIAGEM --output .private/recuperacao-viagem.txt
```

Para autorizar explicitamente o proprietário da coleção dessa viagem, incluindo viagens futuras:

```powershell
npm run provision -- --scope collection --trip UUID_DA_VIAGEM --output .private/recuperacao-colecao.txt
```

O link de recuperação é salvo somente no arquivo privado, com prazo e uso limitado. Abra-o em um aparelho do proprietário e remova o arquivo depois. Nunca envie esse arquivo ou seus tokens a logs, repositórios ou canais públicos. A recuperação de coleção amplia o escopo de acesso de forma explícita. Não é necessária para novos usuários: cadastrar a primeira viagem cria atomicamente sua coleção privada e sua autorização de proprietário.

## Uso e navegação

- **Minhas viagens:** pesquisa por nome ou destino; filtros Todas, Próximas, Em andamento, Passadas e Arquivadas; carregamento incremental. Viagens sem período completo aparecem como **Datas a definir**.
- **Nova viagem:** nome e orçamento inicial obrigatórios; orçamento zero é válido e orçamento vazio é recusado. Destino, pessoas e datas podem ser definidos depois. O fuso sugerido é `America/Sao_Paulo` e pode ser alterado.
- **Dentro da viagem:** `/viagens/ID/cronograma`, `/gastos`, `/resumo` e `/detalhes`. O nome e o destino permanecem visíveis; **Minhas viagens** e **Trocar viagem** permitem escolher outra. Formulários alterados pedem confirmação antes de descarte.
- **Histórico:** a situação usa o dia de calendário no fuso da viagem; o último dia inteiro conta como em andamento. Viagens passadas continuam editáveis, inclusive para registrar pagamentos esquecidos ou antecipados.
- **Arquivar/desarquivar:** muda apenas a visibilidade na lista, com confirmação para arquivar. Nenhum lançamento, data ou orçamento é apagado. Não há exclusão definitiva de viagens.

A seleção de viagem fica no endereço e no dispositivo, sem forçar a troca em outros aparelhos. Convites antigos em `/#convite=TOKEN` continuam restritos à viagem. Convites de coleção usam `/#colecao=TOKEN`; os tokens são removidos do endereço antes de chamadas assíncronas e não entram no cache da PWA.

## Acesso privado em vários aparelhos

A ação de compartilhamento oferece três escopos:

Na tela **Minhas viagens**, use **Compartilhar todas** para criar um único convite que inclui todas as viagens que esta identidade possui, mesmo em coleções diferentes, e as que ela criar depois. Para limitar o acesso, abra uma viagem e clique em **Gerar convite** ou use essa ação no menu de três pontos do cartão. Use **Copiar link** ou **Compartilhar link** para abrir o convite no outro aparelho. A lista de convites aguardando uso permite desativar links ainda disponíveis.

1. **Todas as viagens:** inclui as viagens atuais e futuras que a identidade proprietária criar em qualquer coleção.
2. **Coleção:** autoriza explicitamente as viagens atuais e futuras dessa coleção.
3. **Somente esta viagem:** permite consultar e editar essa viagem, incluindo quando estiver passada ou arquivada.

Convites autorizam membros, expiram em 24 horas e têm um uso. Só a identidade que criou um convite para todas as viagens pode listá-lo ou desativá-lo; revogar um convite pendente não remove um acesso já aceito. A remoção de membros é administrativa nesta etapa. O escopo global acompanha a identidade anônima proprietária: limpar a sessão do aparelho que criou as viagens troca essa identidade, e viagens novas nessa outra sessão não entram automaticamente no convite antigo. Uma sessão anônima diferente nunca é presumida como sendo a mesma pessoa.

Todas as leituras e gravações validam a sessão no Supabase. RLS isola viagens, atividades, gastos e coleções. As funções SQL usam `search_path` vazio e verificam versões, valores, vínculo de atividade à mesma viagem e permissões. Não há escrita pública direta nas tabelas. Criar uma viagem e sua autorização ocorre na mesma transação. Registros de atividades e gastos não podem ser transferidos alterando `trip_id`.

### Hospedagem no Render

Publique como **Web Service**, com build `npm ci && npm run build` e inicialização `npm start`. Configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` no ambiente do serviço antes do build e habilite Anonymous Sign-Ins no projeto Supabase. Depois de alterar código ou variáveis públicas, faça um novo deploy.

Referência: [publicar um aplicativo Next.js no Render](https://render.com/docs/deploy-nextjs-app). O script `npm start` escuta em `0.0.0.0` e o Next usa a variável `PORT` fornecida pelo Render.

Os convites usam o endereço em que o aplicativo está aberto: no Render, o link usa `https://SEU_SERVICO.onrender.com` ou o domínio próprio acessado. O botão não depende de `NEXT_PUBLIC_APP_URL` e não reutiliza um endereço de localhost da configuração. Para convidar outro aparelho, gere o link no site publicado. Os tokens ficam no fragmento do link e apenas na memória do formulário; ao aceitar, o aplicativo remove o token do endereço e mantém a autorização da sessão. A migração `202610120003_convite_todas_viagens.sql` precisa estar aplicada no Supabase para compartilhar todas as viagens.

## Planejamento e gastos

O cronograma preserva **Data e hora**, **Orçamento (R$)**, **Nome da atividade**, **Lugar** e **Tipo** (Refeição, Lazer ou Atividade). Lugares podem ser escolhidos no Photon/OpenStreetMap ou informados manualmente. Referências antigas são preservadas.

Para cada viagem, B é o orçamento inicial guardado como referência, G a soma dos gastos confirmados e P o que ainda está reservado nas atividades. A reserva de cada atividade é o máximo entre zero e o orçamento previsto menos os gastos com vínculo explícito. Um excesso em uma atividade não reduz a reserva de outra, e atividade com orçamento a definir não recebe um valor inventado.

- Saldo disponível: **D = B − G**. O mesmo valor aparece em Gastos e como orçamento disponível do cronograma.
- Saldo livre após o planejamento: **D − P**.
- Projeção de custo: **G + P**, sem somar de novo um gasto já vinculado à atividade.

O orçamento inicial não é decrementado e os saldos não são gravados à parte. Orçamento ausente não vira zero e não gera alerta de excesso. Orçamento zero é válido. Cada viagem é calculada sozinha; filtros e paginação não alteram esses indicadores.

Gastos têm descrição, categoria, valor positivo, data de calendário, atividade opcional e observações. O pagamento pertence à viagem selecionada mesmo quando ocorreu fora do período. Excluir uma atividade mantém os gastos, removendo apenas o vínculo. Filtros alteram subtotais; os totais gerais sempre consideram todos os registros da viagem, inclusive além da primeira página do banco.

## Relatório do cronograma em PNG

Na viagem desejada, abra **Cronograma → Gerar relatório**. Em **Conteúdo do relatório**, escolha **Cronograma completo** (padrão) ou **Cronograma de um dia**. A lista diária inclui todas as datas com atividades, mostra suas quantidades e respeita o fuso da viagem, mesmo nas atividades fora do período cadastrado. Se houver filtros na tela, **Somente atividades dos filtros atuais** fica disponível como uma opção separada. A troca de escopo ou dia pede uma nova prévia antes de baixar ou compartilhar. Confira todas as páginas da prévia; **Ampliar** permite ler o arquivo na resolução original. **Conferir conteúdo em texto** oferece uma alternativa acessível à imagem.

Cada relatório contém data e hora no fuso da viagem, orçamento previsto, nome completo, lugar e endereço salvos, tipo e observação. No relatório diário, o cabeçalho e o resumo identificam somente o dia escolhido; o arquivo usa essa data no nome. No relatório completo, o resumo considera todas as atividades. Os totais sempre somam somente os orçamentos previstos do escopo exportado, sem alterar gastos, saldo ou orçamento inicial. O PNG tem fundo branco e dimensões fixas de **2000 × 1414**, inclusive em celular em pé. Conteúdo extenso continua em páginas horizontais numeradas, com identificação da viagem e do dia em cada página. A geração lê todas as páginas autorizadas do banco e verifica alterações durante a consulta.

Use **Baixar PNG** em cada página ou **Baixar todas as páginas (ZIP)** para salvar o conjunto. O botão **Enviar pelo WhatsApp** abre o compartilhamento nativo de arquivos quando o navegador permite: selecione WhatsApp, destinatário e confirme o envio. Em aparelhos que não aceitam várias imagens juntas, use **Compartilhar página** em cada imagem. Se anexos não forem suportados, baixe os PNGs e anexe-os manualmente à conversa. O aplicativo não confirma a entrega ao destinatário. Em produção, use HTTPS; a política `web-share=(self)` permite o compartilhamento no próprio aplicativo.

Prévia, download e compartilhamento usam os mesmos arquivos PNG, preparados antes do clique de compartilhamento. Uma alteração detectada no cronograma pede **Atualizar relatório**; falha ou cancelamento mantém a prévia disponível. A geração ocorre localmente, sem bucket público, link de acesso ou envio de dados a um serviço de imagens.

Offline, a geração exige uma cópia do cronograma comprovadamente completa e informa a última sincronização no relatório. Cópias antigas ou parciais exigem nova sincronização; indisponibilidade dos gastos não impede um relatório de cronograma completo. O envio pelo WhatsApp exige conexão.

Os testes de relatório em `tests/report-browser.mjs` integram `npm run test:app` (ou `npm run test:app -- --report-only` para verificar só o relatório): escopo completo e diário, meia-noite em outro fuso, data fora do período, paginação longa, filtros separados e data selecionada no nome do PNG. Incluem Chrome de computador, tela emulada de 390 × 844 em pé, download e ZIP, igualdade entre prévia e arquivos compartilhados, troca de escopo, isolamento entre viagens, erros e shell PWA offline. A Web Share API é simulada nesses testes para inspecionar os arquivos; eles não comprovam envio real ao WhatsApp. Safari/iPhone, Android físico e PWA instalada devem ser conferidos em aparelhos reais no endereço HTTPS publicado.

## Sincronização, conflitos e consulta offline

Dados confirmados e histórico permanecem no Supabase. As gravações exigem internet e confirmação do servidor. UUIDs estáveis evitam duplicação em repetições de cadastro; alterações concorrentes usam controle de versão e oferecem carregar a versão atual.

Consultas, respostas pendentes, eventos e cache são separados por projeto, sessão e viagem. Ao trocar de viagem, respostas antigas são ignoradas e dados da viagem anterior não são exibidos durante o carregamento. O aplicativo atualiza ao recuperar conexão, receber alterações, voltar ao foco e periodicamente. Se a permissão for removida, as cópias privadas correspondentes são descartadas após a verificação online e o aplicativo retorna à lista autorizada.

A lista offline identifica as viagens consultáveis neste aparelho e sua última sincronização. Uma viagem só tem consulta completa offline depois de sincronizar seu cronograma e gastos. A interface avisa que a cópia local pode ser parcial; ela não é o histórico completo nem uma autorização para operações no servidor. Sem internet, não é possível confirmar novas viagens, alterações ou arquivamentos. Rascunhos abertos continuam na memória sem entrar nos indicadores; recarregar ou fechar pode descartá-los e pede confirmação.

O service worker guarda apenas o shell público e os arquivos estáticos, sem respostas privadas, tokens ou pesquisas externas. Novas versões oferecem atualização sem recarregar um formulário alterado automaticamente. Para instalação e consulta offline, use produção em HTTPS ou localhost:

```powershell
npm run build
npm start
```

No Android/Chrome e computador, use **Instalar aplicativo**; no iPhone/Safari, **Compartilhar → Adicionar à Tela de Início**. Abra e sincronize cada viagem necessária com conexão antes de depender dela offline.

## Verificação

```powershell
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:app
```

Os testes de banco executam migrações reais em PostgreSQL local com PGlite. Verificam RLS, reexecução preservando registros e permissões, criação atômica, convites de viagem, coleção e identidade inteira, acesso automático a viagens futuras, idempotência, arquivamento, isolamento, transferências bloqueadas, centavos e conflitos. Não usam banco de produção.

O teste de aplicativo compila em `.next-test`, usa uma simulação HTTP do Supabase exclusivamente em memória e Chrome instalado. Verifica os fluxos da interface, vários contextos de navegador, formulários, troca de viagem, indicadores e consulta offline. Registros fictícios existem somente nessa simulação. As capturas ficam em `artifacts/`. `npm run test:ui` faz uma verificação da interface sem backend configurado.

Antes de uso real, aplique 006 e 007 no Supabase, publique a aplicação com as variáveis públicas corretas e valide um convite em outro aparelho, sincronização remota, revogação administrativa de acesso e instalação em HTTPS. Os testes locais não comprovam Auth/Realtime remotos nem disponibilidade do Photon.

## Organização e problemas comuns

- `app/`: lista e rotas de viagem, estilos, manifesto e páginas informativas.
- `components/`: lista, cronograma, gastos, resumo, configurações, compartilhamento e PWA.
- `lib/`: tipos, validações, acesso autorizado, consultas e cache separado por viagem.
- `supabase/migrations/`: atualizações incrementais do banco e regras de isolamento.
- `supabase/tests/` e `tests/`: verificações locais, sem dados reais.
- `scripts/provision-owner.mjs`: recuperação explícita de propriedade da viagem ou coleção.

**Atualização de múltiplas viagens pendente:** aplique `202610080006_multiplas_viagens.sql` depois de 005 e aguarde a atualização do schema da Data API.

**Convite para todas as viagens pendente:** aplique `202610120003_convite_todas_viagens.sql` e depois `202610120004_reparar_acesso_convite_site.sql` no SQL Editor do Supabase; aguarde a atualização do schema da Data API.

**Compartilhamento e exclusão por participantes pendentes:** aplique `202610120006_acoes_viagem_participantes.sql` no SQL Editor do Supabase e aguarde a atualização do schema da Data API.

**Exclusão de viagem antiga bloqueada por `shared_trip_trip_id_fkey`:** aplique `202610120007_excluir_viagem_compartilhada.sql` no SQL Editor do Supabase e aguarde a atualização do banco. A atualização remove o vínculo legado automaticamente junto com a viagem.

**Observações de atividade pendentes:** aplique `202610120001_observacao_atividade.sql` depois de 006 e aguarde a atualização do schema da Data API.

**Viagem ausente em um aparelho novo:** use um convite privado; a identidade de outro aparelho não é reutilizada automaticamente. Confira o escopo, a validade e o uso do convite.

**Sessão anônima indisponível:** habilite Anonymous Sign-Ins; confira URL, chave pública e eventuais limites ou CAPTCHA.

**Conflito de edição:** carregue a versão atual e revise as alterações antes de salvar. Não altere versões manualmente no banco.

**Pesquisa de lugares indisponível:** use o modo manual ou configure um servidor Photon HTTPS compatível com CORS. A busca recebe o texto digitado, sem registros da viagem ou credenciais.
