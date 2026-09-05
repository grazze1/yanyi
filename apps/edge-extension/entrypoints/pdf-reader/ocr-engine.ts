export interface OcrRegion {
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
}
export interface OcrResult {
  language: string;
  regions: OcrRegion[];
}
export interface OcrEngine {
  readonly id: string;
  readonly enabled: boolean;
  readonly statusMessage: string;
  recognize(image: ImageData, language: string, signal: AbortSignal): Promise<OcrResult>;
}

export const disabledOcrEngine: OcrEngine = {
  id: 'disabled',
  enabled: false,
  statusMessage: '本地 OCR 模块未安装，扫描页不会上传到远程服务。',
  recognize: async () => Promise.reject(new Error('OCR_DISABLED')),
};
