/**
 * Links vêm de texto escrito por pessoas e por IAs (notas, eventos do calendário): só http(s) e mailto viram <a href>.
 * Bloqueia `javascript:`, `data:`, `vbscript:` etc. (XSS armazenado). Devolve `undefined` quando não for seguro.
 */
export function urlSegura(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.trim());
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined; // relativo ou malformado: não vira link
  }
}
