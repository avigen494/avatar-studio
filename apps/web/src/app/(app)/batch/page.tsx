import type { Metadata } from "next";
import { BatchScreen } from "@/components/video/BatchScreen";

export const metadata: Metadata = { title: "Batch from CSV" };

export default function BatchPage() {
  return <BatchScreen />;
}
