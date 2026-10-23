import type { Metadata } from "next";
import { LabScreen } from "@/components/lab/LabScreen";

export const metadata: Metadata = { title: "Engine Lab" };

export default function LabPage() {
  return <LabScreen />;
}
