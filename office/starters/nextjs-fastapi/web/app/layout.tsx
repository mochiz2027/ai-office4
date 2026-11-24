import type { ReactNode } from 'react';

export const metadata = { title: '{{name}}' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
