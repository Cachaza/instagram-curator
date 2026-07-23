import { CheckSquare, Clock3 } from "lucide-react";
import { listContent } from "@/lib/content";
import { requireSession } from "@/lib/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  await requireSession();
  const actions = [...listContent({ action: "action" }), ...listContent({ action: "someday" })];
  return (
    <div className="page-container">
      <section className="page-hero"><p className="section-kicker">PARA HACER</p><h1>Acciones<span>.</span></h1><p>Ideas que no querías limitarte a guardar.</p></section>
      <div className="action-list">{actions.map((item) => <Link href={`/publications/${item.id}`} key={item.id}><span className={`action-icon action-${item.actionStatus}`}>{item.actionStatus === "action" ? <CheckSquare /> : <Clock3 />}</span><div><small>{item.category}</small><h2>{item.title}</h2><p>{item.nextAction ?? item.summary}</p></div><span className="pill">{item.actionStatus}</span></Link>)}</div>
    </div>
  );
}
