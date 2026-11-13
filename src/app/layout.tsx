import type { Metadata, Viewport } from "next";
// One family for everything, bundled with the app (no Google fetch at
// build or load time). Plex has true tabular figures, so dial counts,
// times and phone numbers line up and never jitter as they change.
import "@fontsource-variable/ibm-plex-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aperture Calls",
  description: "Call queue, logging and follow-ups for Aperture's outbound calling.",
};

export const viewport: Viewport = {
  themeColor: "#eef1f4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
