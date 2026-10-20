import { createFileRoute } from "@tanstack/react-router";
import { WorldPanel } from "@/components/nexus/WorldPanel";
import { PageHeader } from "@/components/nexus/ui";

export const Route = createFileRoute("/mundo")({
  head: () => ({ meta: [
    { title: "Mundo — RPG-Atlas Mobile" }, { name: "description", content: "Entidades, mapas e marcadores guardados neste aparelho." },
    { property: "og:title", content: "Mundo — RPG-Atlas Mobile" }, { property: "og:description", content: "Organize entidades e mapas da crônica." },
  ] }),
  component: () => <><PageHeader title="Mundo" subtitle="Entidades, mapas e marcadores locais." /><WorldPanel /></>,
});
