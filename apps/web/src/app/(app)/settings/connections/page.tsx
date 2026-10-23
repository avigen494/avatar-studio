import type { Metadata } from "next";
import { ConnectionsScreen } from "@/components/admin/ConnectionsScreen";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
