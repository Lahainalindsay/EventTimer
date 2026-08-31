import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Event Timer — Live Event Timing & Run of Show",
  description: "Keep every speaker, cue, display, and segment synchronized with a live event timer and intelligent run of show.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
