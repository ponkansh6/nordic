import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
  GoogleGenerativeAI: vi.fn(),
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: mocks.GoogleGenerativeAI,
}));

import { backoffMs, callGemini, LLM_MODEL } from "@/lib/llm/client";

describe("Gemini client", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_API_KEY", "test-api-key");
    mocks.generateContent.mockReset();
    mocks.getGenerativeModel
      .mockReset()
      .mockReturnValue({ generateContent: mocks.generateContent });
    mocks.GoogleGenerativeAI.mockReset().mockImplementation(function () {
      return { getGenerativeModel: mocks.getGenerativeModel };
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("computes exponential backoff with jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(backoffMs(2, 100)).toBe(450);
    expect(backoffMs(0, 100)).toBe(150);
  });

  it("validates configuration and returns Gemini text", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "");
    await expect(callGemini("prompt", 500, 4_000)).rejects.toThrow(
      "GOOGLE_API_KEY environment variable is not set",
    );
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();

    vi.stubEnv("GOOGLE_API_KEY", "test-api-key");
    mocks.generateContent.mockResolvedValue({
      response: Promise.resolve({ text: () => '{"ok":true}' }),
    });
    await expect(callGemini("article prompt", 500, 4_000, 0)).resolves.toBe('{"ok":true}');
    expect(mocks.GoogleGenerativeAI).toHaveBeenCalledWith("test-api-key");
    expect(mocks.getGenerativeModel).toHaveBeenCalledWith({
      model: LLM_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 500,
        temperature: expect.any(Number),
      },
    });
    expect(mocks.generateContent).toHaveBeenCalledWith("article prompt", { timeout: 4_000 });
  });

  it("retries transient and rate-limit errors before succeeding", async () => {
    vi.useFakeTimers();
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error("service unavailable"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }))
      .mockResolvedValueOnce({ response: Promise.resolve({ text: () => "recovered" }) });
    const result = callGemini("prompt", 500, 1_000, 2);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("recovered");
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
  });

  it("wraps permanent and exhausted retry failures with their cause", async () => {
    mocks.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("bad request"), { status: 400 }),
    );
    await expect(callGemini("prompt", 10, 1_000, 0)).rejects.toMatchObject({
      message: "Gemini API error: bad request (status: 400)",
      cause: expect.objectContaining({ status: 400 }),
    });

    vi.useFakeTimers();
    mocks.generateContent.mockRejectedValue(new Error("timeout"));
    const result = callGemini("prompt", 10, 1_000, 1);
    const assertion = expect(result).rejects.toMatchObject({
      message: "Gemini API error: timeout (status: unknown)",
    });
    await vi.runAllTimersAsync();
    await assertion;
  });
});
