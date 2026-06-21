import { CalculatorWorkspace } from "@/components/calculator-workspace";
import { callRentalFunction } from "@/lib/rental-server";
import type { BootstrapPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  const initialData = await callRentalFunction<BootstrapPayload>("bootstrap");

  return <CalculatorWorkspace initialData={initialData} />;
}
