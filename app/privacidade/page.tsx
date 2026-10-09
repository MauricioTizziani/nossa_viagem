import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import styles from '../legal.module.css';

export const metadata = { title: 'Privacidade · Nossas Viagens' };

export default function Privacy() {
  return (
    <main className={styles.legalPage}>
      <div className={styles.legalShell}>
        <header className={styles.legalHeader}>
          <div className={styles.brand}>
            <Image src="/logo.png" alt="" width={48} height={48} className={styles.brandImage} />
            <span>Nossas Viagens</span>
          </div>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={18} aria-hidden="true" />
            Voltar para Nossas Viagens
          </Link>
        </header>

        <article className={styles.legalDocument}>
          <div className={styles.documentHeading}>
            <h1>Privacidade</h1>
          </div>

          <section className={styles.legalSection} aria-labelledby="dados-armazenados">
            <h2 id="dados-armazenados">Dados armazenados</h2>
            <p>O aplicativo guarda no Supabase as configurações da viagem, atividades, valores previstos, gastos registrados (descrição, categoria, valor, data e observações), referências de lugares e associações dos aparelhos conectados. Uma identidade anônima é criada automaticamente, sem pedir e-mail ou senha.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="sessao-aparelho">
            <h2 id="sessao-aparelho">Sessão e dados no aparelho</h2>
            <p>O navegador mantém sua sessão para reconhecer o aparelho e uma cópia dos dados necessários da viagem para consulta offline, separada por sessão e viagem. Essa cópia inclui os dados da viagem e os lugares OpenStreetMap selecionados, com nome, endereço e coordenadas. A sessão e a cópia podem ser removidas ao apagar os dados do site; uma nova sessão precisa receber um convite privado para recuperar o acesso às viagens de outra identidade.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="pesquisa-lugares">
            <h2 id="pesquisa-lugares">Pesquisa de lugares</h2>
            <p>Ao pesquisar um lugar, seu navegador envia o texto da busca ao servidor Photon, que recebe também seu IP e informações normais de conexão, como idioma e origem do site. Não enviamos atividades, orçamentos, convites nem credenciais do Supabase à pesquisa. O lugar que você escolher, incluindo referência OpenStreetMap, nome, endereço e coordenadas, será guardado com a atividade para sincronização e consulta offline. As demais sugestões ficam somente em memória, sem histórico de buscas no banco.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="servicos-externos">
            <h2 id="servicos-externos">Mapas e serviços externos</h2>
            <p>Ao abrir mapas ou rotas, você acessa um site externo, sujeito às suas próprias políticas. Os dados dos lugares têm atribuição a <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors</a>. O Supabase e a hospedagem processam os dados necessários para operar o aplicativo conforme a configuração do proprietário.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="acesso-compartilhamento">
            <h2 id="acesso-compartilhamento">Acesso e compartilhamento</h2>
            <p>A lista de viagens é privada. Um convite pode autorizar somente uma viagem ou, de forma explícita, a coleção de viagens atuais e futuras. Conhecer o endereço ou o identificador não concede acesso. Os convites têm prazo e uso limitado; seus tokens não são guardados nos caches. Revogar um convite impede novos usos, mas não remove membros já autorizados. A remoção de membros é administrativa. Não usamos ferramentas de análise ou publicidade.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="solicitacoes-dados">
            <h2 id="solicitacoes-dados">Solicitações sobre seus dados</h2>
            <p>Para consultar, corrigir ou excluir os dados da viagem, use os recursos do aplicativo ou contate a pessoa que administra e compartilhou a viagem. Ela é responsável pela configuração, retenção e atendimento de solicitações.</p>
          </section>

          <footer className={styles.legalFooter}>
            <Link href="/termos">Termos de uso</Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
