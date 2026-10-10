import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/shared/providers/AuthProvider';
import { LocaleProvider } from '@/shared/providers/LocaleProvider';
import { ToastProvider } from '@/shared/providers/ToastProvider';
import { ServiceWorkerRegister } from '@/shared/components/ServiceWorkerRegister';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ChatUp',
  description: 'Real-time messaging that keeps up with you.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ChatUp',
  },
  formatDetection: { telephone: false },
  other: {
    // Android equivalent of apple-mobile-web-app-capable (Next has no
    // first-class field for it); appleWebApp.capable above covers iOS.
    'mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={`${inter.className} min-h-dvh antialiased`} suppressHydrationWarning>
        <ServiceWorkerRegister />
        <LocaleProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
