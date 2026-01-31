import Anthropic from '@anthropic-ai/sdk';
import { config, retryConfig } from '../config/settings';
import { thumbnailInfoPrompt } from '../templates/thumbnail';
import { xpostPrompt } from '../templates/xpost';
import type { DatabaseOptions } from './notion';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.claude.apiKey,
    });
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

export interface ArticleMetadata {
  category: string;
  slug: string;
  seoKeywords: string[];
  subCategories: string[];
  tags: string[];
  targetReaders: string[];
  themeCategories: string[];
}

// 既存のオプションを使ってメタデータを生成
export async function generateMetadataWithOptions(
  articleContent: string,
  title: string,
  options: DatabaseOptions
): Promise<ArticleMetadata> {
  return withRetry(async () => {
    const anthropic = getClient();

    const prompt = `以下の記事内容を分析し、Notionプロパティ用のメタデータを生成してください。

【重要】カテゴリ、サブカテゴリ、テーマカテゴリ、タグ、ターゲット読者は、必ず以下の既存オプションから選択してください。新しい値を創作しないでください。

## 既存オプション

### カテゴリ（1つ選択）
${options.categories.join(', ')}

### サブカテゴリ（1-3個選択）
${options.subCategories.join(', ')}

### テーマカテゴリ（1-2個選択）
${options.themeCategories.join(', ')}

### タグ（1-5個選択）
${options.tags.join(', ')}

### ターゲット読者（1-3個選択）
${options.targetReaders.join(', ')}

## 記事タイトル
${title}

## 記事内容
${articleContent}

## 出力形式（JSON）
{
  "category": "上記カテゴリから1つ選択",
  "slug": "URLスラッグ（英数字とハイフンのみ、小文字、タイトルから生成）",
  "seoKeywords": ["SEOキーワード1", "SEOキーワード2", "SEOキーワード3"],
  "subCategories": ["上記サブカテゴリから1-3個選択"],
  "tags": ["上記タグから1-5個選択"],
  "targetReaders": ["上記ターゲット読者から1-3個選択"],
  "themeCategories": ["上記テーマカテゴリから1-2個選択"]
}

JSONのみを出力してください。`;

    console.log('メタデータを生成中...');

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    // JSONを抽出してパース
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('メタデータのJSON抽出に失敗しました');
    }

    const metadata = JSON.parse(jsonMatch[0]) as ArticleMetadata;

    // オプションの検証
    if (!options.categories.includes(metadata.category)) {
      console.warn(`警告: カテゴリ "${metadata.category}" は既存オプションにありません。最初のカテゴリを使用します。`);
      metadata.category = options.categories[0] || 'career';
    }

    metadata.subCategories = metadata.subCategories.filter(sc => options.subCategories.includes(sc));
    metadata.themeCategories = metadata.themeCategories.filter(tc => options.themeCategories.includes(tc));
    metadata.tags = metadata.tags.filter(tag => options.tags.includes(tag));
    metadata.targetReaders = metadata.targetReaders.filter(tr => options.targetReaders.includes(tr));

    return metadata;
  }, 'メタデータ生成');
}

export interface ThumbnailInfo {
  mainTitle: string;
  subTitle: string;
  backgroundTheme: string;
}

export async function generateThumbnailInfo(
  articleTitle: string,
  articleContent: string
): Promise<ThumbnailInfo> {
  return withRetry(async () => {
    const anthropic = getClient();
    const prompt = thumbnailInfoPrompt(articleTitle, articleContent);

    console.log('サムネイル情報を生成中...');

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    // JSONを抽出してパース
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('サムネイル情報のJSON抽出に失敗しました');
    }

    return JSON.parse(jsonMatch[0]) as ThumbnailInfo;
  }, 'サムネイル情報生成');
}

export async function generateXPost(articleContent: string): Promise<string> {
  return withRetry(async () => {
    const anthropic = getClient();
    const prompt = xpostPrompt(articleContent);

    console.log('X投稿文を生成中...');

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    // 140文字以内に切り詰め
    if (content.length > 140) {
      content = content.slice(0, 137) + '...';
    }

    return content.trim();
  }, 'X投稿文生成');
}
