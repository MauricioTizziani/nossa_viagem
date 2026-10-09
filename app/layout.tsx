import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './trips.css';

const figtree = localFont({ src: './fonts/Figtree.ttf', variable: '--font-figtree', display: 'swap', weight: '300 900' });

export const metadata: Metadata = {
  title: 'Nossas Viagens · Pequenos planos, grandes memórias',
  description: 'Um cantinho para planejar os próximos momentos a dois.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Nossas Viagens' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#28AEB9', viewportFit: 'cover' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={figtree.variable}><body>{children}</body></html>;
}
