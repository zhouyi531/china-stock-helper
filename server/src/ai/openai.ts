import { config } from "../config.js";

export interface AiStreamResult {
  /** async iterator of text deltas */
  deltas: AsyncGenerator<string>;
}

export class OpenAiNotConfigured extends Error {
  constructor() {
    super("未配置 OPENAI_API_KEY，无法调用 AI 分析");
    this.name = "OpenAiNotConfigured";
  }
}

/**
 * Stream a Responses API completion. The static `prefix` is sent as the first
 * input item (so OpenAI prompt-caching can reuse it); `dynamic` carries the
 * per-stock data and is sent as the trailing user message.
 */
export async function* streamResponses(
  prefix: string,
  dynamic: string
): AsyncGenerator<string> {
  if (!config.openai.apiKey) throw new OpenAiNotConfigured();

  const body = {
    model: config.openai.model,
    input: [
      { role: "system", content: prefix },
      { role: "user", content: dynamic },
    ],
    stream: true,
    // helps route requests with the same prefix to the same cache
    prompt_cache_key: config.openai.promptCacheKey,
  };

  const res = await fetch(`${config.openai.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 500)}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  // Node 18+ exposes fetch body as an async-iterable web stream.
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let evt: any;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      const type = evt?.type as string | undefined;
      if (type === "response.output_text.delta" && typeof evt.delta === "string") {
        yield evt.delta;
      } else if (type === "response.error" || type === "error") {
        throw new Error(evt?.error?.message || "OpenAI streaming error");
      } else if (type === "response.failed") {
        throw new Error(evt?.response?.error?.message || "OpenAI response failed");
      }
    }
  }
}
