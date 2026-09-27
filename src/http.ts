export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function readJson(response: Response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.ok
        ? "Сервер вернул некорректный ответ. Обновите страницу."
        : `Сервис временно недоступен (HTTP ${response.status}). Повторите запрос позже.`,
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === "string"
        ? data.error
        : `Запрос не выполнен (HTTP ${response.status})`,
      response.status,
    );
  if (!data || typeof data !== "object")
    throw new ApiError("Сервер вернул некорректный ответ", response.status);
  return data;
}

export async function getJson(url: string, signal?: AbortSignal) {
  try {
    const timeout = AbortSignal.timeout(25000);
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return await readJson(response);
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error;
    throw new Error(
      "Не удалось связаться с сервером. Проверьте соединение и повторите запрос.",
    );
  }
}
