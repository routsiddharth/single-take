import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "single take — post the prompt. link the result.",
  description:
    "A global feed of AI prompts and what they built. Post the prompt, link the result, upvote the best. Nothing gets edited — the prompt is the record.",
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,500&family=Newsreader:ital,opsz,wght@0,6..72,300..800;1,6..72,300..800&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
