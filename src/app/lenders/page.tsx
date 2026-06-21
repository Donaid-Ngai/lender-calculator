import { LendersWorkspace } from "@/components/lenders-workspace";
import { callRentalFunction } from "@/lib/rental-server";
import type { BootstrapPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LendersPage() {
  const initialData = await callRentalFunction<BootstrapPayload>("bootstrap");

  return <LendersWorkspace initialData={initialData} />;
}
