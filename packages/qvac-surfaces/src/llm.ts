/**
 * The on-device LLM adapter shared by the Gaffer and translate.
 *
 * Real inference is QVAC (Llama-3.2-1B Q4_0, proven fully local in the S0c
 * spike) — loaded lazily, zero network at inference. {@link FakeLlm} is the test
 * double and the scripted-demo path. No LLM output ever touches the money path:
 * these surfaces are banter and translation only.
 */
export interface ChatTurn {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LlmAdapter {
  complete(history: readonly ChatTurn[]): Promise<string>;
}

/** Deterministic stub — echoes a templated reply so tests assert wiring, not vibes. */
export class FakeLlm implements LlmAdapter {
  constructor(private readonly reply: (history: readonly ChatTurn[]) => string) {}
  async complete(history: readonly ChatTurn[]): Promise<string> {
    return this.reply(history);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const dynImport = (m: string): Promise<Any> => import(m);

export interface QvacLlmConfig {
  readonly modelSrc: unknown;
  readonly onProgress?: (fraction: number) => void;
}

/** Real QVAC LLM. Loaded lazily; streams tokens locally and returns the full text. */
export class QvacLlm implements LlmAdapter {
  private constructor(
    private readonly sdk: Any,
    private readonly modelId: string,
  ) {}

  static async load(config: QvacLlmConfig): Promise<QvacLlm> {
    const sdk = await dynImport("@qvac/sdk");
    const modelId = await sdk.loadModel({
      modelSrc: config.modelSrc,
      onProgress: (p: { progress?: number }) => config.onProgress?.(p?.progress ?? 0),
    });
    return new QvacLlm(sdk, modelId);
  }

  async complete(history: readonly ChatTurn[]): Promise<string> {
    const result = this.sdk.completion({ modelId: this.modelId, history, stream: true });
    let out = "";
    for await (const token of result.tokenStream) out += token;
    return out.trim();
  }

  async unload(): Promise<void> {
    await this.sdk.unloadModel({ modelId: this.modelId });
  }
}
