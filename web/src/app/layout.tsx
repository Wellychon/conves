import type { Metadata } from "next";
import "@/styles/tokens.css";
import "@/styles/componentes.css";
import "@/styles/app.css";
import { Defs } from "@/components/Defs";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Convés · Piena",
  description: "Contexto compartilhado, presença, kanban e grafo da Piena.",
};

const temaAntesDaPintura = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem('conves.tema')}catch(e){}
if(!t)t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'escuro':'claro';d.setAttribute('data-tema',t);})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-tema="claro" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: temaAntesDaPintura }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=Instrument+Serif:ital@0;1&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
        />
      </head>
      <body>
        <Defs />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
