import Anthropic from '@anthropic-ai/sdk';
import { config, retryConfig } from '../config/settings';
import {
  researchPrompt,
  articlePrompt,
  metadataPrompt,
} from '../templates/article';
import { thumbnailInfoPrompt } from '../templates/thumbnail';
import { xpostPrompt } from '../templates/xpost';

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

export interface ResearchResult {
  content: string;
  references: string[];
}

export async function performResearch(
  title: string,
  strategyGuide: string
): Promise<ResearchResult> {
  return withRetry(async () => {
    const anthropic = getClient();
    const prompt = researchPrompt(title, strategyGuide);

    console.log('Webリサーチを実行中...');

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: 8192,
      tools: [
        {
          type: 'web_search',
          name: 'web_search',
        } as any,
      ],
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // レスポンスからテキストを抽出
    let content = '';
    const references: string[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    // 参考URLを抽出（簡易的なパターンマッチング）
    const urlPattern = /https?:\/\/[^\s\)]+/g;
    const matches = content.match(urlPattern);
    if (matches) {
      references.push(...new Set(matches));
    }

    return { content, references };
  }, 'Webリサーチ');
}

export async function generateArticle(
  title: string,
  researchResult: string,
  strategyGuide: string
): Promise<string> {
  return withRetry(async () => {
    const anthropic = getClient();
    const prompt = articlePrompt(title, researchResult, strategyGuide);

    console.log('記事を生成中...');

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: 8192,
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

    return content;
  }, '記事生成');
}

export interface ArticleMetadata {
  category: string;
  slug: string;
  seoKeywords: string[];
  subCategory: string;
  tags: string[];
  targetReaders: string;
  themeCategory: string;
  articlePurpose: string;
  readerInsight: string;
}

export async function generateMetadata(
  articleContent: string
): Promise<ArticleMetadata> {
  return withRetry(async () => {
    const anthropic = getClient();
    const prompt = metadataPrompt(articleContent);

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

    return JSON.parse(jsonMatch[0]) as ArticleMetadata;
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
