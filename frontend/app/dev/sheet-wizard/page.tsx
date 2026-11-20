import { notFound } from "next/navigation";

import { SheetCreationWizardFixture } from "../../../components/sheet-creation-wizard-fixture";

// Fake-data harness for checking the creation wizard in a browser; never served in production builds.
export default function SheetWizardDevPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SheetCreationWizardFixture />;
}
