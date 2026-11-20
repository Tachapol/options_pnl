import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Options Journal",
  description: "A private journal for your options trades.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* MANDATORY: Declare support for both light and dark themes to prevent FOUC */}
        <meta name="color-scheme" content="light dark" />
      </head>
      <body>{children}</body>
    </html>
  );
}
