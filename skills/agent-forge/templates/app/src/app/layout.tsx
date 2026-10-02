import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';
import { referenceOf } from '@/reference';
import './globals.css';

const titles = {
  support: 'Support assistant',
  researcher: 'Document researcher',
  background: 'Scheduled digests',
};
/** Provide the explicitly selected reference title and a source-grounded description. */
export function generateMetadata(): Metadata {
  return { title: titles[referenceOf()], description: 'Source-grounded agent reference' };
}
/** Responsive viewport without disabling browser zoom. */
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** Render the English-language application shell, semantic theme and wrapping navigation around each route. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
          <Nav title={titles[referenceOf()]} />
          <main className="flex flex-1 flex-col pb-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
