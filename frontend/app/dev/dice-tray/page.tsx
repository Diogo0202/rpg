import { notFound } from "next/navigation";

import { DiceTrayFixture } from "../../../components/dice-tray-fixture";

// Fixed-value harness for checking the 3D dice in a browser; never served in production builds.
export default function DiceTrayDevPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DiceTrayFixture />;
}
