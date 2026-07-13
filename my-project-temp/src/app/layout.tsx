import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";
import { ThemeProviderRoot } from "@/components/theme-provider-root";
import { circularStd } from "@/lib/fonts/circular";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Apical — The AI agent that runs on your machine.",
  description:
    "Your files, your API keys, your data — nothing leaves your computer unless you say so. Tell Apical what needs doing; a local agent does the busywork and hands you the result.",
  keywords: ["Apical", "AI agents", "local-first", "BYOK", "automation", "MCP", "task runner"],
  authors: [{ name: "Apical" }],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Apical — The AI agent that runs on your machine.",
    description: "Local-first AI agents. Your files, your keys, your data.",
    siteName: "Apical",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Apical — The AI agent that runs on your machine.",
    description: "Local-first AI agents. Your files, your keys, your data.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Tag the document for Tauri (desktop) before hydration. Inline head
            script executes synchronously, so it cannot trip React 19's
            "script inside a component won't execute" client-render warning. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(window.__TAURI_INTERNALS__||window.__TAURI__){document.documentElement.setAttribute('data-tauri','');}}catch(e){}})();",
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${circularStd.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProviderRoot>
          <Providers>
            {children}
            <Toaster />
          </Providers>
        </ThemeProviderRoot>
      </body>
    </html>
  );
}
