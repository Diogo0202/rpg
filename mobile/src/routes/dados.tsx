import { createFileRoute } from "@tanstack/react-router";
import { DicePanel } from "@/components/nexus/DicePanel";
import { PageHeader } from "@/components/nexus/ui";

export const Route = createFileRoute("/dados")({
  head: () => ({ meta: [
    { title: "Dados — RPG-Atlas Mobile" }, { name: "description", content: "Rolagens e histórico guardados neste aparelho." },
    { property: "og:title", content: "Dados — RPG-Atlas Mobile" }, { property: "og:description", content: "Rolador local para a mesa." },
  ] }),
  component: () => <><PageHeader title="Dados" subtitle="Rolagens locais, sem envio para a mesa." /><DicePanel /></>,
});
