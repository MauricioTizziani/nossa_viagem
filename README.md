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

Faça uma cópia de segurança do banco antes de aplicar migrações em produção. Em uma instalação nova, aplique as migrações de `supabase/migrations/` na ordem 001 a 006. Em um banco atualizado até 005, aplique somente:

**`202610080006_multiplas_viagens.sql`**

Essa migração preserva os identificadores, períodos, valores, atividades, gastos, lugares, vínculos e membros existentes. Cada viagem antiga recebe uma coleção privada. Todas as autorizações antigas, inclusive de proprietários, continuam restritas às viagens que já podiam acessar. O acesso à coleção exige uma autorização explícita; convites antigos de proprietário também não ampliam esse escopo. Uma reexecução não duplica registros nem promove convites de uma viagem para toda a coleção.

A migração encerra o acesso automático de qualquer visitante do modelo 003. Os aparelhos com autorizações já concedidas continuam vendo suas viagens. O endereço do aplicativo e o ID da viagem, sozinhos, não autorizam acesso. Não reaplique a migração histórica 003 depois de 006.

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

A ação de compartilhamento oferece dois escopos diferentes:

1. **Somente esta viagem:** permite consultar e editar essa viagem, incluindo quando estiver passada ou arquivada.
2. **Coleção:** autoriza explicitamente as viagens atuais e futuras dessa coleção.

Somente proprietários do escopo correspondente geram ou revogam convites. Convites comuns autorizam membros, expiram em 24 horas e têm um uso. A interface permite revogar convites ainda não utilizados; revogar um convite não remove uma autorização já concedida. A remoção de membros é administrativa nesta etapa. Limpar a sessão do navegador perde a identidade daquele aparelho: será necessário um novo convite para recuperar viagens compartilhadas. Outra sessão anônima não é presumida como sendo da mesma pessoa.

Todas as leituras e gravações validam a sessão no Supabase. RLS isola viagens, atividades, gastos e coleções. As funções SQL usam `search_path` vazio e verificam versões, valores, vínculo de atividade à mesma viagem e permissões. Não há escrita pública direta nas tabelas. Criar uma viagem e sua autorização ocorre na mesma transação. Registros de atividades e gastos não podem ser transferidos alterando `trip_id`.

## Planejamento e gastos

O cronograma preserva **Data e hora**, **Orçamento (R$)**, **Nome da atividade**, **Lugar** e **Tipo** (Refeição, Lazer ou Atividade). Lugares podem ser escolhidos no Photon/OpenStreetMap ou informados manualmente. Referências antigas são preservadas.

Para cada viagem, B é seu orçamento inicial, P a soma dos orçamentos de suas atividades e G a soma de seus gastos:

- Saldo do planejamento: **B − P**.
- Saldo conforme gastos registrados: **B − G**.

Os dois acompanhamentos são independentes. Não se calcula B − P − G nem se somam saldos de viagens como dinheiro disponível. Valores são armazenados em centavos inteiros. Orçamentos antigos ausentes continuam ausentes, sem alertas de excesso, até que sejam definidos.

Gastos têm descrição, categoria, valor positivo, data de calendário, atividade opcional e observações. O pagamento pertence à viagem selecionada mesmo quando ocorreu fora do período. Excluir uma atividade mantém os gastos, removendo apenas o vínculo. Filtros alteram subtotais; os totais gerais sempre consideram todos os registros da viagem, inclusive além da primeira página do banco.

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

Os testes de banco executam migrações reais em PostgreSQL local com PGlite. Verificam RLS, reexecução preservando registros e permissões, criação atômica, convites de viagem e coleção, idempotência, arquivamento, isolamento, transferências bloqueadas, centavos e conflitos. Não usam banco de produção.

O teste de aplicativo compila em `.next-test`, usa uma simulação HTTP do Supabase exclusivamente em memória e Chrome instalado. Verifica os fluxos da interface, vários contextos de navegador, formulários, troca de viagem, indicadores e consulta offline. Registros fictícios existem somente nessa simulação. As capturas ficam em `artifacts/`. `npm run test:ui` faz uma verificação da interface sem backend configurado.

Antes de uso real, aplique 006 no Supabase, publique a aplicação com as variáveis públicas corretas e valide um convite em outro aparelho, sincronização remota, revogação administrativa de acesso e instalação em HTTPS. Os testes locais não comprovam Auth/Realtime remotos nem disponibilidade do Photon.

## Organização e problemas comuns

- `app/`: lista e rotas de viagem, estilos, manifesto e páginas informativas.
- `components/`: lista, cronograma, gastos, resumo, configurações, compartilhamento e PWA.
- `lib/`: tipos, validações, acesso autorizado, consultas e cache separado por viagem.
- `supabase/migrations/`: atualizações incrementais do banco e regras de isolamento.
- `supabase/tests/` e `tests/`: verificações locais, sem dados reais.
- `scripts/provision-owner.mjs`: recuperação explícita de propriedade da viagem ou coleção.

**Atualização de múltiplas viagens pendente:** aplique `202610080006_multiplas_viagens.sql` depois de 005 e aguarde a atualização do schema da Data API.

**Viagem ausente em um aparelho novo:** use um convite privado; a identidade de outro aparelho não é reutilizada automaticamente. Confira o escopo, a validade e o uso do convite.

**Sessão anônima indisponível:** habilite Anonymous Sign-Ins; confira URL, chave pública e eventuais limites ou CAPTCHA.

**Conflito de edição:** carregue a versão atual e revise as alterações antes de salvar. Não altere versões manualmente no banco.

**Pesquisa de lugares indisponível:** use o modo manual ou configure um servidor Photon HTTPS compatível com CORS. A busca recebe o texto digitado, sem registros da viagem ou credenciais.