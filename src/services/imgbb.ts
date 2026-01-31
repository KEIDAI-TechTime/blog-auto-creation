import { config, retryConfig } from '../config/settings';

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

export interface ImgbbUploadResult {
  url: string;
  displayUrl: string;
  deleteUrl: string;
}

export async function uploadToImgbb(
  imageData: Buffer,
  filename: string = 'thumbnail'
): Promise<ImgbbUploadResult> {
  return withRetry(async () => {
    console.log('imgbbに画像をアップロード中...');

    // Base64エンコード
    const base64Image = imageData.toString('base64');

    // FormDataを構築
    const formData = new URLSearchParams();
    formData.append('key', config.imgbb.apiKey);
    formData.append('image', base64Image);
    formData.append('name', filename);

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`imgbb APIエラー: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      data: {
        url: string;
        display_url: string;
        delete_url: string;
      };
    };

    if (!result.success) {
      throw new Error(`imgbbアップロード失敗: ${JSON.stringify(result)}`);
    }

    console.log('imgbbへのアップロードが完了しました');

    return {
      url: result.data.url,
      displayUrl: result.data.display_url,
      deleteUrl: result.data.delete_url,
    };
  }, 'imgbbアップロード');
}
