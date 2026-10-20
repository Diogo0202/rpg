import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Campanhas",
  robots: { index: false, follow: false, noarchive: true },
};

export default function PrivateAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
