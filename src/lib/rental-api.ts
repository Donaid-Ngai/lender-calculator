import { supabase } from "@/lib/supabase/client";

export async function invokeRentalApi<T = void>(
  action: string,
  payload?: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("rental-lending-api", {
    body: {
      action,
      payload,
    },
  });

  if (error) {
    throw error;
  }

  return data as T;
}
