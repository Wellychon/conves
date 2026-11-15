/** Sprite SVG da identidade: texturas (cobertura de tinta = "mais"), símbolo e ícones de traço. */
export function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="p-vazio" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" style={{ fill: "var(--papel)" }} /></pattern>
        <pattern id="p-cinza" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" style={{ fill: "var(--cinza-3)" }} /></pattern>
        <pattern id="p-solido" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" style={{ fill: "var(--tinta)" }} /></pattern>
        <pattern id="p-pontos" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" style={{ fill: "var(--papel)" }} /><circle cx="4" cy="4" r="1.3" style={{ fill: "var(--tinta)" }} />
        </pattern>
        <pattern id="p-cruzes" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="11" height="11" style={{ fill: "var(--papel)" }} /><path d="M5.5 2.5v6M2.5 5.5h6" style={{ fill: "none", stroke: "var(--tinta)", strokeWidth: 1.2 }} />
        </pattern>
        <pattern id="p-hachura-aberta" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" style={{ fill: "var(--papel)" }} /><line x1="4" y1="0" x2="4" y2="8" style={{ stroke: "var(--tinta)", strokeWidth: 1.6 }} />
        </pattern>
        <pattern id="p-hachura-densa" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" style={{ fill: "var(--papel)" }} /><line x1="2.5" y1="0" x2="2.5" y2="5" style={{ stroke: "var(--tinta)", strokeWidth: 1.5 }} />
        </pattern>
        <pattern id="p-quadriculado" width="6.5" height="6.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6.5" height="6.5" style={{ fill: "var(--papel)" }} /><path d="M3.25 0V6.5M0 3.25H6.5" style={{ fill: "none", stroke: "var(--tinta)", strokeWidth: 1.4 }} />
        </pattern>

        {/* símbolo do Convés: barco de proa para cima; a sombra dura cai para baixo */}
        <symbol id="simbolo" viewBox="0 0 48 56">
          <path d="M5 30h38l-7 20H12z" transform="translate(0 6)" style={{ fill: "currentColor" }} />
          <path d="M24 6v24M24 9l15 17H24z" transform="translate(0 0)" style={{ fill: "var(--papel)", stroke: "currentColor", strokeWidth: 3.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
          <path d="M5 30h38l-7 20H12z" style={{ fill: "var(--papel)", stroke: "currentColor", strokeWidth: 3.5, strokeLinejoin: "round" }} />
          <path d="M13 38q4.5-5 9 0t9 0" style={{ fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }} />
        </symbol>

        <symbol id="i-som-on" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></symbol>
        <symbol id="i-som-off" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9l5 6M22 9l-5 6" /></symbol>
        <symbol id="i-lua" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></symbol>
        <symbol id="i-seta" viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6" /></symbol>
        <symbol id="i-lupa" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></symbol>
        <symbol id="i-vazio" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5M8 10.5h5" /></symbol>
        <symbol id="i-lista" viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></symbol>
        <symbol id="i-mais" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
        <symbol id="i-grafo" viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.2 8.3l2.6 7.4M15.8 7.8l-2.6 8M8.5 7h7" /></symbol>
        <symbol id="i-alvo" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></symbol>
      </defs>
    </svg>
  );
}

export function Icone({ id, className = "btn__ico" }: { id: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** Amostra retangular de textura (legenda de coluna, tipo, etc.). */
export function Amostra({ textura, w = 34, h = 18 }: { textura: string; w?: number; h?: number }) {
  return (
    <svg className="amostra-leg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="3" fill={`url(#${textura})`} stroke="var(--tinta)" strokeWidth="2" />
    </svg>
  );
}

/** Disco de pessoa: textura própria + inicial (nunca cor). */
export function Disco({ textura, inicial, size = 30 }: { textura: string; inicial: string; size?: number }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="disco">
      <circle cx={r} cy={r + 1.5} r={r - 2} fill="var(--tinta)" />
      <circle cx={r} cy={r} r={r - 2} fill={`url(#${textura})`} stroke="var(--tinta)" strokeWidth="2.5" />
      <text x={r} y={r + 0.5} textAnchor="middle" dominantBaseline="central" className="disco__letra">{inicial}</text>
    </svg>
  );
}
