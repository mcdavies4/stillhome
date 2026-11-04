import { notFound } from "next/navigation";
import AskClient from "./AskClient";

// Hidden until NEXT_PUBLIC_PAYFORME_ENABLED=1 (then redeploy). Nothing on the site links here yet.
export default function Page() {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  return <AskClient />;
}
