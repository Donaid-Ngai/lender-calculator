export async function invokeRentalApi<T = void>(
  action: string,
  payload?: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/rental-lending", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      payload,
    }),
  });

  const data = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? data.error
        : "Unable to complete rental lending request.";
    throw new Error(message);
  }

  return data as T;
}
