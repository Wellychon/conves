// Convés · política de contexto por pedido.
//
// A cada pedido (hook UserPromptSubmit), o servidor devolve candidatos que parecem
// relevantes ao texto: aprendizados das IAs, decisões e trechos de notas. Esta função
// decide o que de fato entra no contexto do Claude — e, portanto, quantos tokens custa.
//
// itens:    [{ id: "l:a1b2c3d4" | "d:…" | "n:…", tipo: "aprendizado" | "decisao" | "nota",
//              texto: string (até 200 caracteres), score: number (0 a 1, maior = mais relevante) }]
//           já vêm ordenados por score, do maior para o menor (no máximo 8).
// jaVistos: Set com os ids que já foram injetados nesta sessão.
// retorno:  os itens a injetar, na ordem em que devem aparecer ([] = não injeta nada).
//
// Política (escolhida pelo Claude em 2026-11-06, por delegação do Welly). Os números abaixo são
// um ponto de partida #hipotese: calibre com pedidos reais quando o servidor novo estiver no ar.
//   1. Nunca repete o que já entrou nesta sessão (o que entra fica na conversa e custa de novo).
//   2. Nota mínima: pedido curto ou genérico ("ok", "continua") só casa por acaso; abaixo do
//      limiar o melhor é não injetar nada.
//   3. Prioridade por tipo: regra/erro evitam repetir falha, decisão evita contradição e nota é
//      só um apontador (o Claude lê o arquivo local se precisar). A ordem usa score × peso.
//   4. O limite é de caracteres, não de itens: ~600 caracteres ≈ 150 tokens por pedido, no máximo 3.

// 0,10 deixava passar ruído: medindo 4 pedidos reais em 2026-11-06, "Monte o plano" trouxe notas de planos de saúde
// com score 0,16 a 0,24, e os casos que casaram de verdade ficaram em 0,27 a 0,49. Por isso 0,25. #hipotese (amostra pequena)
const NOTA_MINIMA = 0.25;
const ORCAMENTO = 600;
const MAX_ITENS = 3;
const PESO = { aprendizado: 1.3, decisao: 1.2, nota: 1 };
const PESO_REGRA_OU_ERRO = 1.6; // aprendizado cujo texto começa com "regra:" ou "erro:"

const peso = (i) =>
  i.tipo === "aprendizado" && /^(regra|erro):/i.test(i.texto) ? PESO_REGRA_OU_ERRO : (PESO[i.tipo] ?? 1);

export function escolherContexto(itens, jaVistos = new Set()) {
  if (!Array.isArray(itens)) return [];
  const candidatos = itens
    .filter((i) => i && i.texto && !jaVistos.has(i.id) && i.score >= NOTA_MINIMA)
    .sort((a, b) => b.score * peso(b) - a.score * peso(a));

  const escolhidos = [];
  let gasto = 0;
  for (const i of candidatos) {
    if (escolhidos.length >= MAX_ITENS) break;
    if (gasto + i.texto.length > ORCAMENTO) continue; // um item menor, mais abaixo, ainda pode caber
    escolhidos.push(i);
    gasto += i.texto.length;
  }
  return escolhidos;
}
