import { createFileRoute } from "@tanstack/react-router";
import { WorldPanel } from "@/components/nexus/WorldPanel";
import { PageHeader } from "@/components/nexus/ui";

export const Route = createFileRoute("/mundo")({
  head: () => ({ meta: [
    { title: "Mundo — RPG-Atlas Mobile" }, { name: "description", content: "Entidades da crônica guardadas neste aparelho." },
    { property: "og:title", content: "Mundo — RPG-Atlas Mobile" }, { property: "og:description", content: "Organize as entidades da crônica." },
  ] }),
  component: () => <><PageHeader title="Mundo" subtitle="NPCs, locais, facções e itens da crônica." /><WorldPanel /></>,
});
