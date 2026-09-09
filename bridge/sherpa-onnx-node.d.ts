// sherpa-onnx-node ships plain JavaScript. This declares only the offline
// (whole-utterance) recognizer surface the bridge actually calls.
declare module "sherpa-onnx-node" {
  interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }

  interface OfflineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  }

  interface OfflineRecognizerConfig {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads: number;
      provider: string;
      debug: number;
      modelType: string;
    };
    decodingMethod: string;
  }

  class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): { text: string };
  }

  function readWave(path: string): Wave;
}
