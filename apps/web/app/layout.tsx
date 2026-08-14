import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegistration } from "./components/pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veylta",
  description: "Семейная история здоровья с проверяемыми источниками",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Veylta",
  },
  icons: {
    apple: "/icons/veylta-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1649d8",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
