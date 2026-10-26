import { currentSession } from "@/lib/session";
import { isSetupComplete } from "@/lib/settings";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  if (!await isSetupComplete() && session.user.role === "admin") redirect("/setup");
  redirect("/library");
}
