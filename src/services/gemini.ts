import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, retryConfig } from '../config/settings';
import { thumbnailPrompt } from '../templates/thumbnail';

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return client;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;
  let delay = retryConfig.initialDelayMs;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.error(
        `${operationName} 失敗 (試行 ${attempt}/${retryConfig.maxRetries}):`,
        lastError.message
      );

      if (attempt < retryConfig.maxRetries) {
        console.log(`${delay}ms後にリトライします...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= retryConfig.backoffMultiplier;
      }
    }
  }

  throw new Error(
    `${operationName} が${retryConfig.maxRetries}回の試行後に失敗しました: ${lastError?.message}`
  );
}

export interface ThumbnailResult {
  imageData: Buffer;
  mimeType: string;
}

export async function generateThumbnailImage(
  mainTitle: string,
  subTitle: string,
  backgroundTheme: string
): Promise<ThumbnailResult> {
  return withRetry(async () => {
    const genAI = getClient();
    const prompt = thumbnailPrompt(mainTitle, subTitle, backgroundTheme);

    console.log('サムネイル画像を生成中...');

    // Gemini 2.0 Flash Experimental で画像生成
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['image', 'text'],
      } as any,
    });

    const response = result.response;
    const candidates = response.candidates;

    if (!candidates || candidates.length === 0) {
      throw new Error('画像生成の応答が空です');
    }

    // 画像データを探す
    for (const candidate of candidates) {
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if ('inlineData' in part && part.inlineData) {
            const imageData = Buffer.from(part.inlineData.data, 'base64');
            const mimeType = part.inlineData.mimeType || 'image/png';
            console.log('サムネイル画像の生成が完了しました');
            return { imageData, mimeType };
          }
        }
      }
    }

    throw new Error('生成結果に画像データが含まれていません');
  }, 'サムネイル画像生成');
}
