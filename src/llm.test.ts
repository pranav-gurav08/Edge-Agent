import { describe, expect, it } from "vitest";
import { MockLLM, LlamaCppLLM, type LocalLLM, type LLMResult } from "./llm.js";

describe("MockLLM", () => {
  it("returns scripted responses when provided", async () => {
    const key = "sys\n---\nuser";
    const llm = new MockLLM(new Map([[key, "scripted-response"]]));
    const r = await llm.invoke("sys", "user");
    expect(r.content).toBe("scripted-response");
  });

  it("falls back to deterministic placeholder", async () => {
    const llm = new MockLLM();
    const r = await llm.invoke("system", "user");
    expect(r.content).toMatch(/^MOCK_TRIAGE/);
    expect(llm.name).toBe("mock");
  });

  it("conforms to LocalLLM interface", async () => {
    const llm: LocalLLM = new MockLLM();
    const result: LLMResult = await llm.invoke("sys", "user");
    expect(typeof result.content).toBe("string");
  });
});

describe("LlamaCppLLM", () => {
  it("rejects on non-2xx responses", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("upstream-down", { status: 503 })) as unknown as typeof fetch;
    try {
      const llm = new LlamaCppLLM({ baseURL: "http://127.0.0.1:1/v1", timeoutMs: 500 });
      await expect(llm.invoke("s", "u")).rejects.toThrow(/llama\.cpp 503/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("returns content from OpenAI-shaped chat completions response", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello from local" } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      const llm = new LlamaCppLLM({ baseURL: "http://127.0.0.1:9/v1", timeoutMs: 500 });
      const r = await llm.invoke("s", "u");
      expect(r.content).toBe("hello from local");
      expect(r.usage?.inputTokens).toBe(5);
      expect(r.usage?.outputTokens).toBe(3);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("honors env-var defaults", () => {
    process.env.LLAMA_BASE_URL = "http://example.test/v1";
    process.env.LLAMA_MODEL = "test-model";
    const llm = new LlamaCppLLM();
    expect(llm.name).toBe("llama");
    delete process.env.LLAMA_BASE_URL;
    delete process.env.LLAMA_MODEL;
  });
});
