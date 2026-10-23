import type { Metadata } from "next";
import { DevelopersScreen } from "@/components/developer/DevelopersScreen";

export const metadata: Metadata = { title: "Developers" };

export default function DevelopersPage() {
  return <DevelopersScreen />;
}
