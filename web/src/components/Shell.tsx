"use client";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { usePresencaWeb } from "@/lib/aovivo";
import { definirSom, iniciarSom, somLigado } from "@/lib/som";
import { TEXTURA_MEMBRO, type Member } from "@/lib/types";
import { Disco, Icone } from "./Defs";

type Ctx = { me: Member; members: Member[] };
const AppCtx = createContext<Ctx | null>(null);
export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp fora do Shell");
  return c;
}

const NAV = [
  { href: "/", rotulo: "Quadro" },
  { href: "/aovivo", rotulo: "Ao vivo" },
  { href: "/calendario", rotulo: "Calendário" },
  { href: "/grafo", rotulo: "Grafo" },
  { href: "/notas", rotulo: "Notas" },
  { href: "/organizacao", rotulo: "Organização" },
  { href: "/equipe", rotulo: "Equipe" },
  { href: "/decisoes", rotulo: "Decisões" },
];

export const texturaDe = (m?: Member | null) => TEXTURA_MEMBRO[m?.textura ?? ""] ?? "p-hachura-densa";

export function Shell({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[] | null>(null);

  useEffect(() => {
    iniciarSom();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) { setMembers(null); return; }
    supabase.from("members").select("*").order("nome").then(({ data }) => setMembers((data ?? []) as Member[]));
  }, [uid]);

  if (session === undefined) return <Carregando texto="abrindo o convés" />;
  if (!session) return <Login />;
  if (members === null) return <Carregando texto="conferindo acesso" />;
  const me = members.find((m) => m.user_id === uid);
  if (!me) return <SemAcesso email={session.user.email ?? ""} />;

  return (
    <AppCtx.Provider value={{ me, members }}>
      <div className="app">
        <Topo me={me} />
        <main className="app-main" id="principal">
          <div className="pagina">{children}</div>
        </main>
      </div>
    </AppCtx.Provider>
  );
}

function Topo({ me }: { me: Member }) {
  const rota = usePathname();
  usePresencaWeb(me);
  const [som, setSom] = useState(true);
  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    setSom(somLigado());
    setEscuro(document.documentElement.getAttribute("data-tema") === "escuro");
    const f = (e: Event) => setSom((e as CustomEvent).detail.ligado);
    document.addEventListener("som:mudou", f);
    return () => document.removeEventListener("som:mudou", f);
  }, []);

  function alternarTema() {
    const novo = escuro ? "claro" : "escuro";
    document.documentElement.setAttribute("data-tema", novo);
    try { localStorage.setItem("conves.tema", novo); } catch { /* sem storage */ }
    setEscuro(!escuro);
  }

  return (
    <header className="topo">
      <div className="pagina topo__in">
        <Link href="/" className="marca" aria-label="Convés, início">
          <svg className="simbolo" viewBox="0 0 48 56" aria-hidden="true"><use href="#simbolo" /></svg>
          Convés
        </Link>
        <nav className="topo__nav" aria-label="Principal">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={(n.href === "/" ? rota === "/" : rota.startsWith(n.href)) ? "page" : undefined}>
              {n.rotulo}
            </Link>
          ))}
        </nav>
        <div className="topo__ctl">
          <span className="eu" title={me.email}>
            <Disco textura={texturaDe(me)} inicial={me.nome[0]} size={28} />
            <span>{me.nome}</span>
          </span>
          <button className="btn btn--icone btn--chip" type="button" aria-pressed={som} aria-label="Som" title="Ligar ou desligar os sons"
            onClick={() => definirSom(!som)}>
            <Icone id={som ? "i-som-on" : "i-som-off"} />
          </button>
          <button className="btn btn--icone btn--chip" type="button" aria-pressed={escuro} aria-label="Tema escuro" title="Inverter papel e tinta"
            onClick={alternarTema}>
            <Icone id="i-lua" />
          </button>
          <button className="btn btn--chip btn--fantasma" type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </div>
    </header>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <div className="login">
      <p className="rotulo" role="status">{texto}…</p>
    </div>
  );
}

function SemAcesso({ email }: { email: string }) {
  return (
    <div className="login">
      <div className="login__caixa">
        <span className="carimbo">sem acesso</span>
        <h1 className="titulo-pag">Este e-mail não está na lista</h1>
        <p className="sub-pag"><code>{email}</code> entrou, mas não é membro da Piena. Peça para quem administra cadastrar o e-mail.</p>
        <div><button className="btn" type="button" onClick={() => supabase.auth.signOut()}>Sair</button></div>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"parado" | "enviando" | "enviado" | "erro">("parado");
  const [msg, setMsg] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });
    if (error) { setEstado("erro"); setMsg(error.message); } else setEstado("enviado");
  }

  return (
    <div className="login">
      <div className="login__caixa">
        <svg className="login__simbolo" viewBox="0 0 48 56" aria-hidden="true"><use href="#simbolo" /></svg>
        <h1 className="login__titulo">Con<span className="editorial">vés</span><br /><span className="contorno">Piena</span></h1>
        <p className="sub-pag">Contexto compartilhado, o que cada um está fazendo e o quadro da equipe. Entre com o seu e-mail: mandamos um link, sem senha.</p>
        <form onSubmit={enviar} className="campo-g">
          <label className="campo-g">
            <span className="rotulo">E-mail</span>
            <input className="campo" type="email" required autoComplete="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div className="linha" style={{ marginTop: 6 }}>
            <button className="btn btn--primario" type="submit" aria-disabled={estado === "enviando"}>
              {estado === "enviando" ? "Enviando…" : "Receber link"} <Icone id="i-seta" />
            </button>
            {estado === "enviado" && <span className="carimbo" role="status">link enviado · confira o e-mail</span>}
          </div>
          {estado === "erro" && <p className="vazio-nota" role="alert">Não deu: {msg}</p>}
        </form>
      </div>
    </div>
  );
}
