import { notFound } from "next/navigation";

import { MapEditorFixture } from "../../../components/map-editor/map-editor-fixture";

// Fake-data harness for checking the editor in a browser; never served in production builds.
export default function MapEditorDevPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <MapEditorFixture />;
}
