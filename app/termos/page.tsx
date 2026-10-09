import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import styles from '../legal.module.css';

export const metadata = { title: 'Termos de uso · Nossas Viagens' };

export default function Terms() {
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
            <h1>Termos de uso</h1>
          </div>

          <section className={styles.legalSection} aria-labelledby="uso-aplicativo">
            <h2 id="uso-aplicativo">Uso do aplicativo</h2>
            <p>Nossas Viagens organiza o cronograma, os gastos, os orçamentos e o histórico de várias viagens privadas. Os valores são planejamento. O aplicativo não faz reservas nem pagamentos.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="acesso-convites">
            <h2 id="acesso-convites">Acesso privado e convites</h2>
            <p>O acesso é privado e não exige login e senha. Uma sessão anônima identifica cada navegador. Convites autorizam somente uma viagem ou, quando explicitamente escolhido, uma coleção com suas viagens atuais e futuras. Compartilhe os convites apenas com os aparelhos e pessoas que deseja autorizar. Arquivar uma viagem preserva todos os seus registros; viagens passadas continuam disponíveis para consulta e correção.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="lugares-mapas">
            <h2 id="lugares-mapas">Lugares e mapas</h2>
            <p>A pesquisa de lugares usa Photon com dados do OpenStreetMap. Os dados são disponibilizados pela <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">Open Database License (ODbL)</a>, com atribuição a OpenStreetMap contributors. O serviço público permite uso moderado, pode limitar consultas e não garante disponibilidade. Confirme o endereço antes de visitar um lugar. Os mapas e as rotas abrem em um site externo.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="consulta-offline">
            <h2 id="consulta-offline">Consulta sem conexão</h2>
            <p>Sem conexão, você poderá consultar os dados já sincronizados neste aparelho. Alterações exigem conexão; verifique a confirmação de gravação antes de fechar um formulário.</p>
          </section>

          <section className={styles.legalSection} aria-labelledby="suporte-solicitacoes">
            <h2 id="suporte-solicitacoes">Suporte e solicitações</h2>
            <p>Para suporte, dúvidas ou solicitações, contate a pessoa que administra e compartilhou esta viagem.</p>
          </section>

          <footer className={styles.legalFooter}>
            <Link href="/privacidade">Política de privacidade</Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
