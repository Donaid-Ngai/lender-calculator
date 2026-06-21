type RentalFunctionPayload = {
  action: string;
  payload?: Record<string, unknown>;
};

function getServerConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing server Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

export async function callRentalFunction<T = void>(
  action: string,
  payload?: Record<string, unknown>
): Promise<T> {
  const { supabaseUrl, serviceRoleKey } = getServerConfig();

  const response = await fetch(`${supabaseUrl}/functions/v1/rental-lending-api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: "no-store",
    body: JSON.stringify({
      action,
      payload,
    } satisfies RentalFunctionPayload),
  });

  const data = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? data.error
        : "Supabase Edge Function request failed.";
    throw new Error(message);
  }

  return data as T;
}
