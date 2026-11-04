import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/Header';

// Self-hosted at build time by next/font (no third-party request at runtime). Width axis = meaning.
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });

export const metadata: Metadata = {
  title: 'tally · preconteo en vivo',
  description: 'Reporte informativo de preconteo. El conteo oficial es manual sobre las actas físicas.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

const themeBoot = `try{var t=localStorage.getItem('ballot.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={archivo.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBoot }} /></head>
      <body>
        <Header />
        <main className="mx-auto w-full max-w-[1152px] px-4 pb-16 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
