export interface LLMResult {
  content: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LocalLLM {
  readonly name: string;
  invoke(system: string, user: string): Promise<LLMResult>;
}

export class MockLLM implements LocalLLM {
  readonly name = "mock";
  constructor(private readonly responses?: Map<string, string>) {}
  async invoke(system: string, user: string): Promise<LLMResult> {
    const key = `${system}\n---\n${user}`;
    if (this.responses) {
      const r = this.responses.get(key);
      if (r) return { content: r };
    }
    const stripped = user.replace(/\s+/g, " ").trim();
    return {
      content: `MOCK_TRIAGE: reviewed ${stripped.slice(0, 80)}... — no false positives detected.`,
    };
  }
}

export interface LlamaCppLLMOptions {
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
}

export class LlamaCppLLM implements LocalLLM {
  readonly name = "llama";
  private readonly baseURL: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: LlamaCppLLMOptions = {}) {
    this.baseURL = opts.baseURL ?? process.env.LLAMA_BASE_URL ?? "http://localhost:8080/v1";
    this.model = opts.model ?? process.env.LLAMA_MODEL ?? "llama-3-8b-instruct";
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async invoke(system: string, user: string): Promise<LLMResult> {
    const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      stream: false,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`llama.cpp ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const content = json.choices[0]?.message?.content ?? "";
      return {
        content,
        usage: json.usage
          ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLLM(kind: "mock" | "llama"): LocalLLM {
  if (kind === "llama") return new LlamaCppLLM();
  return new MockLLM();
}
