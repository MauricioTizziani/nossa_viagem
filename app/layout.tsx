import type { Metadata, Viewport } from 'next';
import './globals.css';
import './trips.css';

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
  return <html lang="pt-BR"><body>{children}</body></html>;
}
