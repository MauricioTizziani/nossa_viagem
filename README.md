# Nossa Viagem

Aplicativo privado para planejar uma viagem a dois. React, Next.js com App Router, TypeScript, Tailwind CSS, Supabase, Photon/OpenStreetMap e PWA. A marca usa o ícone e o logo fornecidos pelo proprietário.

O cronograma preserva os cinco campos: **Data e hora**, **Orçamento (R$)**, **Nome da atividade**, **Lugar** e **Tipo**. As categorias são exatamente Refeição, Lazer e Atividade. O orçamento é planejamento, em centavos inteiros; `null` significa “A definir” e zero significa R$ 0,00. Os valores são totais por atividade, sem multiplicação ou divisão entre as pessoas.

Não há tela de login. Uma sessão anônima identifica cada navegador, mas só um convite válido pode associá-lo à viagem. O primeiro proprietário é autorizado por um procedimento administrativo local. O projeto começa vazio e não inclui nomes, destino, período ou atividades fictícias.

## Executar no computador

Requisitos: Node.js 22 ou 24, npm e um projeto Supabase para usar persistência e compartilhamento.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Abra `http://localhost:3000`. Preencha as variáveis públicas reais em `.env.local` e reinicie o servidor após alterações. Sem Supabase configurado, a interface exibe o cronograma vazio com orientação de configuração; não apresenta gravações locais como dados sincronizados.

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública `sb_publishable_…`; nunca uma chave administrativa. |
| `NEXT_PUBLIC_PHOTON_URL` | Endereço HTTPS opcional de um servidor Photon. O padrão é `https://photon.komoot.io/api/`, sem chave. |
| `NEXT_PUBLIC_APP_URL` | Endereço final da aplicação; em desenvolvimento, `http://localhost:3000`. |

As variáveis `NEXT_PUBLIC_` entram no código do navegador. Os arquivos `.env.local`, `.env.owner` e `.private/` estão excluídos do repositório. Não inclua nenhuma chave real em `.env.example`.

## Configurar o Supabase

1. Crie um projeto dedicado e copie sua URL e sua chave **publishable** para `.env.local`.
2. Em Authentication, habilite **Anonymous Sign-Ins**. Mantenha a criação de usuários permitida para este fluxo. Não é necessário configurar e-mail, senha ou provedores sociais.
3. No SQL Editor, execute uma vez `supabase/migrations/202610080001_nossa_viagem.sql` e depois `supabase/migrations/202610080002_openstreetmap.sql`, nessa ordem, como proprietário do banco. A primeira migração cria tabelas, validações, RLS e sincronização; a segunda acrescenta os lugares OpenStreetMap. Se a primeira já foi aplicada, execute somente a segunda. Os arquivos preservam atividades existentes e não devem ser reaplicados.
4. Deixe `public` exposto pela Data API. **Não exponha `private`**: ele contém apenas funções auxiliares e recibos de resgate. As tabelas de acesso não recebem permissões de escrita para navegadores.
5. Confira em Database → Publications que `trips` integra `supabase_realtime`. Não adicione `trip_invites`, `trip_members` ou `activities` à publicação por conta própria. Todas as alterações do cronograma atualizam `trips.updated_at` para sinalizar a viagem e fazer uma nova leitura protegida por RLS.
6. Em Auth, configure Site URL com o endereço da aplicação. Use um domínio HTTPS quando publicar.

Alternativamente, use a CLI oficial em um projeto já inicializado: `supabase link --project-ref SEU_PROJECT_REF` e `supabase db push`. A migração é para um banco novo; não execute o mesmo arquivo novamente no SQL Editor sobre tabelas já criadas.

Uma identidade anônima é um usuário do papel `authenticated`, mas isso não libera os dados da viagem: a política verifica a associação exata em `trip_members`. Sem vínculo, a leitura retorna nenhuma viagem e as operações protegidas são negadas. A documentação oficial explica a [diferença entre autenticação anônima e chave pública](https://supabase.com/docs/guides/auth/auth-anonymous) e o [funcionamento de RLS e permissões](https://supabase.com/docs/guides/database/postgres/row-level-security).

### CAPTCHA e limite de novas sessões

Supabase recomenda CAPTCHA para reduzir abuso na criação de usuários anônimos. Esta versão autentica silenciosamente e **não integra um widget/token CAPTCHA**; ativar CAPTCHA no painel sem integrá-lo ao cliente bloqueará novos aparelhos. Para a implantação privada inicial, mantenha os limites de autenticação do projeto e monitore novas sessões. Para exposição ampla, integre um CAPTCHA invisível e passe `captchaToken` ao `signInAnonymously` antes de ativar a proteção. Essa decisão afeta criação de sessões, não as políticas privadas da viagem. Consulte [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous#abuse-prevention-and-rate-limits) e [CAPTCHA no Supabase](https://supabase.com/docs/guides/auth/auth-captcha).

Não apague automaticamente usuários anônimos por idade: os aparelhos autorizados também usam essas identidades. Uma eventual limpeza deve preservar os `auth.users` relacionados a `trip_members`.

## Autorizar o primeiro aparelho

Este procedimento só deve ser executado no computador controlado pelo proprietário. Ele cria uma viagem vazia e um convite de proprietário com uma utilização e validade de 24 horas. Nenhum visitante do site pode chamar esse procedimento com uma chave pública.

Crie **separadamente** um arquivo `.env.owner`, que não será usado pela aplicação web:

```dotenv
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SECRET_KEY=SEU_SB_SECRET_SOMENTE_LOCAL
APP_URL=http://localhost:3000
```

A chave administrativa atual `sb_secret_…` é preferida. Projetos legados podem usar `SUPABASE_SERVICE_ROLE_KEY` em lugar de `SUPABASE_SECRET_KEY`. Ambas chegam ao papel administrativo `service_role` e jamais devem ter prefixo `NEXT_PUBLIC_`, entrar no frontend ou ser configuradas na hospedagem deste aplicativo. Consulte a [documentação de chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

```powershell
npm run provision
```

O script mostra apenas o ID da viagem e o caminho de `.private/owner-invite.txt`. O link secreto fica nesse arquivo, sem ser impresso nos logs. Abra o arquivo no seu computador e use o link no navegador do proprietário. Após a autorização, guarde o **ID da viagem** para recuperação e apague o arquivo do convite. Restrinja o acesso aos arquivos locais ao seu usuário; no Windows, as permissões herdadas da pasta devem ser privadas.

O convite usa o fragmento `#convite=…`, que não é enviado na navegação HTTP inicial. O cliente remove o fragmento antes de autenticar/resgatar, não o coloca em armazenamento local, analytics ou cache. O resgate envia o token apenas no corpo da chamada segura ao Supabase. Não configure gravação de corpos dessas chamadas ou analytics que capturem URLs/estado de convites.

O script recusa sobrescrever um arquivo existente. Para gerar outro convite, apague localmente o arquivo já utilizado ou escolha um novo destino com `--output`.

### Autorizar outros aparelhos

No aparelho proprietário, abra **Nossa viagem** e a área de compartilhamento. Crie um convite e envie o link apenas a quem poderá consultar **e editar** a viagem. Abra-o no computador/celular desejado. Cada navegador terá sua própria sessão e todos verão a mesma viagem. Não há limite de duas sessões; um convite individual por novo aparelho é a opção mais simples.

O link é uma chave de acesso: qualquer pessoa que o possua poderá resgatá-lo antes de expirar ou de esgotar as utilizações. O banco armazena apenas seu SHA-256; o token aleatório tem 256 bits. Convites podem ser revogados. Revogar um convite impede resgates futuros e não remove aparelhos já autorizados. Um aparelho com papel `member` pode editar o cronograma e configurações, mas somente um `owner` pode administrar convites.

### Recuperar acesso ao apagar dados do navegador

Se ainda houver um aparelho proprietário autorizado, gere nele um novo convite para o navegador limpo. Se todos os proprietários perderem a sessão, use seu computador administrativo e o ID guardado da **mesma viagem**:

```powershell
npm run provision -- --trip UUID_DA_VIAGEM --output .private/recuperacao.txt
```

Use o novo link no aparelho do proprietário e apague o arquivo após o resgate. Esse caminho concede uma nova identidade de proprietário sem recriar a viagem ou publicar seus registros. Não execute a criação sem `--trip` para tentar recuperar uma viagem: isso criaria outra viagem vazia.

Para bloquear um aparelho já associado, use uma operação administrativa no SQL Editor com os IDs exatos:

```sql
delete from public.trip_members
where trip_id = 'UUID_DA_VIAGEM' and user_id = 'UUID_DO_APARELHO';
```

A próxima leitura/gravação online desse aparelho será negada. Uma cópia previamente baixada para consulta offline continua naquele aparelho até ser removida localmente; revogação remota não pode apagar um dispositivo sem conexão.

## Pesquisa de lugares gratuita

O campo **Lugar** usa [Photon](https://github.com/komoot/photon), com dados do OpenStreetMap, sem cadastro, cartão ou chave de API. A pesquisa começa após 3 letras e 800 ms sem digitar, cancela consultas antigas, pede no máximo 6 sugestões e reaproveita pesquisas recentes somente em memória. Inclua a cidade na busca e confira nome/endereço antes de escolher. O sistema não deduz coordenadas a partir de um link digitado manualmente.

O servidor público `photon.komoot.io` aceita uso moderado, mas pode limitar ou bloquear excesso de consultas e não garante disponibilidade. É apropriado para esta implantação pequena; reavalie o provedor se ampliar o público. `NEXT_PUBLIC_PHOTON_URL` permite trocar por outra instância HTTPS compatível. Uma mudança exige recompilação. Hospedar uma base global por conta própria tem custo de infraestrutura.

O local selecionado guarda referência OpenStreetMap (`N/id`, `W/id` ou `R/id`), nome, endereço e as coordenadas realmente retornadas. Essas informações são salvas no Supabase e na cópia privada offline, com atribuição **© OpenStreetMap contributors**. Consulte a [licença dos dados](https://www.openstreetmap.org/copyright) e a [API do Photon](https://github.com/komoot/photon/blob/master/docs/api-v1.md). A pesquisa não guarda histórico no banco. Consultar sugestões envia o texto pesquisado, IP e informações normais de conexão ao provedor.

**Abrir mapa** abre o local no OpenStreetMap. **Traçar rota** abre seu planejador com o destino; a origem e o modo de deslocamento são escolhidos lá. Não se baixam mapas nem se calculam rotas neste aplicativo. A pesquisa e esses sites precisam de conexão, mas nome/endereço de lugares já sincronizados continuam visíveis offline.

Em caso de falta de conexão ou falha de pesquisa, use **Informar manualmente** para nome, endereço ou link HTTPS de mapa. Links OpenStreetMap e links Google Maps fornecidos manualmente são validados. Referências Google antigas são preservadas; a interface orienta selecionar um novo lugar para atualizar seus detalhes. Nenhum serviço de pesquisa, SDK ou chave Google é usado.

Execute a migração `202610080002_openstreetmap.sql` depois da inicial. Ela acrescenta os campos e amplia a função de gravação sem remover dados, alterar o acesso privado ou enfraquecer o controle de versões. Não substituímos a migração inicial porque ela pode já ter sido aplicada.

O serviço público Nominatim não é usado: [sua política proíbe autocomplete no cliente](https://operations.osmfoundation.org/policies/nominatim/). As páginas `/termos` e `/privacidade` descrevem o novo funcionamento. Revise os textos e identifique responsável/contato antes de publicar.

## Sincronização e conflitos

As gravações usam funções SQL autenticadas. Inclusões recebem um UUID estável antes de salvar e uma repetição idêntica não insere outra atividade. Edições e exclusões exigem a versão vista ao abrir o formulário; alterações concorrentes produzem `VERSION_CONFLICT` em vez de sobrescrever dados.

Uma alteração de atividade atualiza `trips.updated_at`, sem alterar a versão das configurações da viagem. O Realtime publica apenas atualizações da viagem, protegidas por RLS; os aparelhos associados refazem a leitura do cronograma. Isso também sincroniza exclusões e evita as limitações de filtragem/RLS dos eventos DELETE do Postgres Changes. O cliente recarrega os dados ao voltar ao aplicativo e ao recuperar conexão. Veja [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

As funções seguras têm `search_path` vazio, referências de schema explícitas, validação de associação e permissões restritas. O resgate bloqueia a linha do convite antes de verificar/consumir a utilização, impedindo dois dispositivos de consumir simultaneamente a última utilização. Um recibo privado permite a repetição idempotente pelo mesmo aparelho quando a primeira resposta se perde.

## PWA e consulta offline

O manifesto usa o nome Nossa Viagem, `standalone`, tema `#3B5F86` e ícones derivados da marca fornecida, incluindo versões maskable com área de segurança. Para testar instalação e service worker, use a compilação de produção em HTTPS ou localhost:

```powershell
npm run build
npm start
```

No Android/Chrome, use **Instalar aplicativo** ou **Adicionar à tela inicial** no menu do navegador. No iPhone/Safari, use **Compartilhar → Adicionar à Tela de Início**. No computador, use o ícone/menu de instalação quando o navegador oferecer. Disponibilidade e texto do menu variam por navegador.

Abra online e sincronize a viagem pelo menos uma vez em cada aparelho antes de depender da consulta offline. O aplicativo mantém somente uma cópia necessária do cronograma, separada pelo ID da viagem e da sessão. Essa cópia pertence ao navegador autorizado, não a um cache compartilhado. A interface informa a falta de conexão e a última sincronização.

Sem internet, os dados já sincronizados podem ser consultados; novas gravações exigem conexão. Um formulário aberto continua preservado na memória se a conexão cair, mas não é apresentado como alteração sincronizada. Fechar/recarregar a página pode descartar esse rascunho; a interface pede confirmação quando houver alterações. Novas versões oferecem atualização sem recarregar automaticamente um formulário em andamento.

O service worker guarda apenas o shell e arquivos estáticos próprios. Não guarda respostas privadas, sessões, convites nem pesquisas externas. Os lugares OpenStreetMap selecionados fazem parte da cópia privada autorizada do cronograma. A autenticação persistente fica no armazenamento administrado pelo SDK Supabase. Navegadores podem apagar dados locais por pressão de armazenamento; perder essa sessão exige novo convite.

Cada `npm run build` gera automaticamente uma versão do service worker a partir dos arquivos do aplicativo e ícones. Uma mudança nesses arquivos prepara o aviso de atualização; não é preciso editar manualmente um número de versão. A consulta offline usa a última cópia autorizada, mesmo se o token temporário da sessão tiver expirado sem conexão; ao reconectar, o acesso é validado novamente no Supabase. A remoção de acesso não pode apagar imediatamente uma cópia em um aparelho desconectado; ela é descartada quando o aplicativo reconecta e detecta a ausência de autorização.

## Publicar

1. Execute os testes e a compilação abaixo.
2. Publique o projeto em uma hospedagem com suporte a Next.js, como Vercel, ou execute `npm start` em um servidor Node atrás de HTTPS. Esta aplicação não usa exportação HTML estática.
3. Configure **somente** as variáveis públicas de `.env.example` na hospedagem. Chaves administrativas permanecem no computador proprietário.
4. Ajuste `NEXT_PUBLIC_APP_URL` e Site URL do Supabase para o domínio final. Recompile após mudar valores públicos. Photon não exige configuração de chave nem de faturamento.
5. Autorize o primeiro aparelho usando `APP_URL=https://SEU_DOMINIO` no `.env.owner`; convites da interface usam o endereço aberto no navegador.
6. Valide dois aparelhos reais, uma sessão sem convite, consulta offline e a instalação da PWA no domínio HTTPS.

Mantenha respostas e páginas privadas fora de cache compartilhado/CDN. A aplicação consulta os dados do usuário no navegador com sua sessão, e configura cabeçalhos sem cache para navegação privada. Não adicione analytics ou logs que capturem tokens, corpos de convites ou registros privados.

## Verificação

```powershell
npm run typecheck
npm test
npm run test:db
npm run build
```

Para verificar a interface com um Chrome já instalado, execute `npm run dev` e, em outro terminal, `npm run test:ui`. Esse teste aceita `BASE_URL` e `BROWSER_EXECUTABLE` e recusa modificar uma viagem conectada. Capturas de computador e celular de 360 px ficam em `artifacts/`.

`npm run test:app` cria um servidor de teste local, uma compilação isolada em `.next-test` e identidades de navegador independentes. Os registros fictícios existem exclusivamente em memória nessa fixture. Isso valida a integração da interface com o contrato HTTP do Supabase, sem conectar à sua viagem ou comprovar o Realtime remoto.

`test:db` executa a migração real em PostgreSQL local via PGlite com `pgcrypto`; não cria projeto remoto e não usa segredos reais. A fixture reproduz papéis e claims do Supabase Auth para testar o banco. Os 25 testes do banco verificam RLS, permissões, convites fortes/hash/validade/revogação/uso/repetição, bloqueio entre viagens, primeiro dono controlado, recuperação, edição concorrente, exclusão, centavos, zero/ausência, fuso, validações de lugares e publicação limitada a `trips`. Outros cinco testes executam o script de provisionamento contra um servidor local de teste, verificando chaves atuais/legadas, recuperação da viagem existente, ausência de tokens/segredos nos logs, recusa de sobrescrita e HTTPS.

Testes locais não substituem um projeto Supabase configurado e a verificação do provedor de pesquisa. Antes de usar a viagem real, valide:

- Cadastro, edição, duplicação para revisão e exclusão confirmada; repetir Salvar não pode duplicar.
- Agrupamento/ordenação por dia, horários iguais, datas passadas e reposicionamento após editar.
- Um mesmo horário planejado em aparelhos configurados com fusos distintos.
- Valores com centavos, zero, “A definir”, categorias, totais diários e subtotal de filtros.
- Pesquisa Photon real, escolha exata, links/rota, remoção e alternativa manual com serviço indisponível.
- Alteração no computador aparecendo no celular; atualizações ao reconectar/reabrir.
- Visitante com sessão anônima sem convite sem acesso; convite vencido/revogado recusado.
- Edição simultânea da mesma atividade em dois aparelhos exibindo conflito.
- Consulta offline após sincronização, sem permitir gravação ou pesquisa de lugares offline.
- Layout a 360 px, navegação inferior, teclado móvel, nomes longos e instalação/atualização da PWA.

Os testes de gravação usam banco e sessões isolados. A disponibilidade da pesquisa Photon foi conferida com uma consulta pública real; sincronização e autorização no Supabase de produção ainda exigem configuração e verificação pelo proprietário.

## Organização

- `app/`: rota principal, layout e manifesto.
- `components/`: cronograma, formulário, lugares, resumo, configurações, compartilhamento e PWA.
- `lib/`: modelos, regras, validações, acesso Supabase e consulta offline.
- `public/`: marca, ícones e service worker.
- `supabase/migrations/`: estrutura, validações, permissões, RLS, RPCs e sincronização.
- `supabase/tests/`: testes reais do banco local.
- `scripts/provision-owner.mjs`: criação/recuperação controlada do primeiro proprietário.
- `tests/`: verificações das regras de negócio.

## Problemas comuns

**“Sessão anônima indisponível”**: habilite Anonymous Sign-Ins; confira chave pública, URL, limites de novas sessões e se CAPTCHA foi ativado sem integração.

**Nenhuma viagem disponível**: o navegador ainda não tem associação. Use um convite válido; conhecer o ID da viagem não concede acesso.

**Convite inválido**: confira validade, revogação e utilizações. Gere outro em um aparelho proprietário ou siga a recuperação administrativa.

**Falha no provisionamento**: confira a migração aplicada e a chave local administrativa. Um arquivo de saída já existente precisa ser removido ou substituído por um novo caminho antes de tentar novamente. Se uma resposta de rede se perdeu, uma viagem/convite pode ter sido criado; consulte o painel administrativo antes de criar outra viagem.

**Pesquisa de lugares indisponível**: confira a conexão e aguarde para tentar novamente; o servidor Photon público pode estar fora do ar ou limitar consultas. Use o modo manual. Se configurar `NEXT_PUBLIC_PHOTON_URL`, use uma instância HTTPS compatível que permita chamadas do navegador (CORS).

**Conflito de edição**: atualize os dados e revise suas alterações antes de salvar novamente. Não altere as versões no banco para contornar o aviso.
