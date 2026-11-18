import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'StreamForge — YouTube Live Studio',
  description: 'Upload a video and broadcast it to YouTube from your own streaming server.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
