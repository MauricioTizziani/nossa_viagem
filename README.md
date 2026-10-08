# Nossa Viagem

Aplicativo para planejar uma viagem a dois, com acesso aberto pelo endereço do aplicativo. React, Next.js com App Router, TypeScript, Tailwind CSS, Supabase, Photon/OpenStreetMap e PWA. A marca usa o ícone e o logo fornecidos pelo proprietário.

O cronograma preserva os cinco campos: **Data e hora**, **Orçamento (R$)**, **Nome da atividade**, **Lugar** e **Tipo**. As categorias são exatamente Refeição, Lazer e Atividade. O orçamento é planejamento, em centavos inteiros; `null` significa “A definir” e zero significa R$ 0,00. Os valores são totais por atividade, sem multiplicação ou divisão entre as pessoas.

Não há tela de login. Uma sessão anônima identifica cada navegador e abre automaticamente a mesma viagem para todos que acessarem o aplicativo. Instalações novas começam vazias, sem nomes, destino, período ou atividades fictícias; atualizações preservam os planos existentes.

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

As variáveis `NEXT_PUBLIC_` entram no código do navegador. Os arquivos `.env.local` e arquivos administrativos antigos estão excluídos do repositório. Não inclua nenhuma chave real em `.env.example`.

## Configurar o Supabase

1. Crie um projeto dedicado e copie sua URL e sua chave **publishable** para `.env.local`.
2. Em Authentication, habilite **Anonymous Sign-Ins**. Mantenha a criação de usuários permitida para este fluxo. Não é necessário configurar e-mail, senha ou provedores sociais.
3. No SQL Editor, execute as migrações 001, 002 e 003, nessa ordem. Se você já executou as duas primeiras, execute somente `supabase/migrations/202610080003_acesso_livre.sql`. Ela ativa o acesso automático, preservando os planos existentes. Depois, atualize/reinicie o aplicativo.
4. Deixe `public` exposto pela Data API. **Não exponha `private`**: ele contém apenas funções auxiliares e recibos de resgate. As tabelas de acesso não recebem permissões de escrita para navegadores.
5. Confira em Database → Publications que `trips` integra `supabase_realtime`. Não adicione `trip_invites`, `trip_members` ou `activities` à publicação por conta própria. Todas as alterações do cronograma atualizam `trips.updated_at` para sinalizar a viagem e fazer uma nova leitura protegida por RLS.
6. Em Auth, configure Site URL com o endereço da aplicação. Use um domínio HTTPS quando publicar.

Alternativamente, use a CLI oficial em um projeto já inicializado: `supabase link --project-ref SEU_PROJECT_REF` e `supabase db push`. A migração é para um banco novo; não execute o mesmo arquivo novamente no SQL Editor sobre tabelas já criadas.

O aplicativo cria uma sessão anônima automaticamente e chama `open_shared_trip()`. Essa função associa qualquer visitante à mesma viagem compartilhada. Não há convite, senha, aprovação de aparelho ou limite de duas pessoas. Qualquer pessoa que obtenha o endereço do aplicativo poderá consultar, adicionar, editar e excluir seus planos. RLS e validações continuam limitando as operações à viagem compartilhada e verificando versões e valores. Consulte [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous) e [funções de banco](https://supabase.com/docs/guides/database/functions).

### CAPTCHA e limite de novas sessões

Supabase recomenda CAPTCHA para reduzir abuso na criação de usuários anônimos. Esta versão autentica silenciosamente e **não integra um widget/token CAPTCHA**; ativar CAPTCHA no painel sem integrá-lo ao cliente bloqueará novos aparelhos. Para esta implantação pequena, mantenha os limites de autenticação do projeto e monitore novas sessões. Para exposição ampla, integre um CAPTCHA invisível e passe `captchaToken` ao `signInAnonymously` antes de ativar a proteção. Essa decisão afeta criação de sessões, não as regras de validação da viagem. Consulte [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous#abuse-prevention-and-rate-limits) e [CAPTCHA no Supabase](https://supabase.com/docs/guides/auth/auth-captcha).

## Abrir a viagem em outros aparelhos

Basta abrir o endereço normal do aplicativo no computador ou celular. A entrada é automática, com a mesma viagem e os mesmos planos. O botão **Compartilhar viagem** mostra esse endereço para copiar. Não há link temporário, convite, cadastro ou liberação manual. Links antigos de convite também passam a abrir a viagem; o fragmento antigo é removido sem resgate de token.

A migração 003 reaproveita a viagem com mais atividades salvas; em caso de empate, seleciona a mais antiga. Se o banco ainda não tiver viagem, cria uma única viagem vazia. Outras viagens antigas permanecem intactas no banco, sem serem abertas pela interface atual. O registro de viagem compartilhada fica em `private.shared_trip`, fora da Data API. As antigas funções de convites deixam de ser acessíveis pelo aplicativo.

Apagar os dados do navegador ou usar um aparelho novo não exige recuperação ou convite: abra o site com conexão novamente. Para consulta offline, cada aparelho precisa ter sincronizado a viagem ao menos uma vez. Não é necessária chave administrativa nem executar `npm run provision`; esse script pertence ao modelo antigo de acesso.

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

As funções de gravação têm `search_path` vazio, referências de schema explícitas e validação de dados e versões. `open_shared_trip()` permite a entrada automática de qualquer visitante na viagem compartilhada; não aceita o ID de uma viagem diferente. Não há escrita direta nas tabelas pelo navegador.

## PWA e consulta offline

O manifesto usa o nome Nossa Viagem, `standalone`, tema `#3B5F86` e ícones derivados da marca fornecida, incluindo versões maskable com área de segurança. Para testar instalação e service worker, use a compilação de produção em HTTPS ou localhost:

```powershell
npm run build
npm start
```

No Android/Chrome, use **Instalar aplicativo** ou **Adicionar à tela inicial** no menu do navegador. No iPhone/Safari, use **Compartilhar → Adicionar à Tela de Início**. No computador, use o ícone/menu de instalação quando o navegador oferecer. Disponibilidade e texto do menu variam por navegador.

Abra online e sincronize a viagem pelo menos uma vez em cada aparelho antes de depender da consulta offline. O aplicativo mantém somente uma cópia necessária do cronograma, separada pelo ID da viagem e da sessão. Essa cópia pertence ao navegador sincronizado, não a um cache compartilhado. A interface informa a falta de conexão e a última sincronização.

Sem internet, os dados já sincronizados podem ser consultados; novas gravações exigem conexão. Um formulário aberto continua preservado na memória se a conexão cair, mas não é apresentado como alteração sincronizada. Fechar/recarregar a página pode descartar esse rascunho; a interface pede confirmação quando houver alterações. Novas versões oferecem atualização sem recarregar automaticamente um formulário em andamento.

O service worker guarda apenas o shell e arquivos estáticos próprios. Não guarda respostas privadas, sessões, convites nem pesquisas externas. Os lugares OpenStreetMap selecionados fazem parte da cópia local do cronograma. A autenticação persistente fica no armazenamento administrado pelo SDK Supabase. Navegadores podem apagar dados locais por pressão de armazenamento; ao perder essa sessão, basta abrir o site com conexão novamente.

Cada `npm run build` gera automaticamente uma versão do service worker a partir dos arquivos do aplicativo e ícones. Uma mudança nesses arquivos prepara o aviso de atualização; não é preciso editar manualmente um número de versão. A consulta offline usa a última cópia sincronizada, mesmo se o token temporário da sessão tiver expirado sem conexão; ao reconectar, o acesso é validado novamente no Supabase. A migração 003 permite acesso automático; não existe fluxo de revogação de aparelhos neste modelo.

## Publicar

1. Execute os testes e a compilação abaixo.
2. Publique o projeto em uma hospedagem com suporte a Next.js, como Vercel, ou execute `npm start` em um servidor Node atrás de HTTPS. Esta aplicação não usa exportação HTML estática.
3. Configure **somente** as variáveis públicas de `.env.example` na hospedagem. Chaves administrativas permanecem no computador proprietário.
4. Ajuste `NEXT_PUBLIC_APP_URL` e Site URL do Supabase para o domínio final. Recompile após mudar valores públicos. Photon não exige configuração de chave nem de faturamento.
5. Aplique a migração 003 no Supabase e abra o endereço da aplicação; a entrada será automática em qualquer aparelho.
6. Valide aparelhos novos entrando automaticamente, consulta offline e a instalação da PWA no domínio HTTPS.

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
- Aparelhos novos abrindo e editando a mesma viagem sem convite; reabrir após limpar dados do navegador.
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
- `scripts/provision-owner.mjs`: ferramenta histórica do modelo antigo; não necessária para acesso livre.
- `tests/`: verificações das regras de negócio.

## Problemas comuns

**“Sessão anônima indisponível”**: habilite Anonymous Sign-Ins; confira chave pública, URL, limites de novas sessões e se CAPTCHA foi ativado sem integração.

**Atualização de acesso livre pendente**: aplique `202610080003_acesso_livre.sql` no SQL Editor, depois das migrações 001 e 002. Recompile/reinicie o aplicativo. Não reaplique as duas migrações anteriores.

**Pesquisa de lugares indisponível**: confira a conexão e aguarde para tentar novamente; o servidor Photon público pode estar fora do ar ou limitar consultas. Use o modo manual. Se configurar `NEXT_PUBLIC_PHOTON_URL`, use uma instância HTTPS compatível que permita chamadas do navegador (CORS).

**Conflito de edição**: atualize os dados e revise suas alterações antes de salvar novamente. Não altere as versões no banco para contornar o aviso.
