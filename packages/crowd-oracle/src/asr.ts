/**
 * On-device speech recognition — the QVAC ASR adapter.
 *
 * The privacy story that makes local AI non-negotiable: a microphone in a pub
 * is the most sensitive sensor imaginable, so the audio NEVER leaves the device.
 * QVAC transcribes ambient commentary locally; the pure {@link extractScore}
 * rule pass turns the transcript into a pre-filled attestation a human signs.
 *
 * The real QVAC model is loaded lazily (heavy, device-only). {@link FakeAsr} is
 * the test double and the fixture-driven demo path (canned commentary clips),
 * so CI and the scripted demo need no model download.
 */

export interface AsrAdapter {
  /** Transcribe a rolling audio window entirely on-device. */
  transcribe(audio: Float32Array | Uint8Array): Promise<string>;
}

/** Canned transcript — for tests and the fixture-clip demo. */
export class FakeAsr implements AsrAdapter {
  constructor(private readonly script: string) {}
  async transcribe(): Promise<string> {
    return this.script;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const dynImport = (m: string): Promise<Any> => import(m);

export interface QvacAsrConfig {
  /** QVAC ASR model source (whisper family), passed through to the SDK. */
  readonly modelSrc: unknown;
  readonly onProgress?: (fraction: number) => void;
}

/** Real on-device ASR via @qvac/sdk. Loaded lazily; runs with zero network at inference. */
export class QvacAsr implements AsrAdapter {
  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly sdk: Any,
    private readonly modelId: string,
  ) {}

  static async load(config: QvacAsrConfig): Promise<QvacAsr> {
    const sdk = await dynImport("@qvac/sdk");
    const modelId = await sdk.loadModel({
      modelSrc: config.modelSrc,
      onProgress: (p: { progress?: number }) => config.onProgress?.(p?.progress ?? 0),
    });
    return new QvacAsr(sdk, modelId);
  }

  async transcribe(audio: Float32Array | Uint8Array): Promise<string> {
    const result = await this.sdk.transcribe({ modelId: this.modelId, audio });
    return typeof result === "string" ? result : (result?.text ?? "");
  }

  async unload(): Promise<void> {
    await this.sdk.unloadModel({ modelId: this.modelId });
  }
}
