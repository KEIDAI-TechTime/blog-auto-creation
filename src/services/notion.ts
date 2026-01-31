import { Client } from '@notionhq/client';
import { config, retryConfig, notionPropertyMapping } from '../config/settings';
import type { ArticleMetadata } from './claude';
import fs from 'fs';
import path from 'path';

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client({
      auth: config.notion.apiKey,
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

// NotionページURLからページIDを抽出
export function extractPageId(notionUrl: string): string {
  // URLパターン: https://www.notion.so/.../{page-id} または https://notion.so/.../{page-id}
  // ページIDは32文字のハイフンなしUUIDまたはハイフン付きUUID
  const patterns = [
    /([a-f0-9]{32})(?:\?|$)/i,
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\?|$)/i,
    /-([a-f0-9]{32})(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = notionUrl.match(pattern);
    if (match) {
      // ハイフンなしのIDを返す
      return match[1].replace(/-/g, '');
    }
  }

  throw new Error(`無効なNotionページURL: ${notionUrl}`);
}

// MarkdownをNotionブロックに変換
function markdownToNotionBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 見出し
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
      i++;
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
      i++;
      continue;
    }

    // callout（引用ブロック）
    if (line.startsWith('> ')) {
      const calloutLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        calloutLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [
            { type: 'text', text: { content: calloutLines.join('\n') } },
          ],
          icon: { emoji: '💡' },
        },
      });
      continue;
    }

    // 箇条書き
    if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseRichText(line.slice(2)),
        },
      });
      i++;
      continue;
    }

    // 番号付きリスト
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: parseRichText(numberedMatch[2]),
        },
      });
      i++;
      continue;
    }

    // コードブロック
    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || 'plain text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: language,
        },
      });
      i++; // 閉じ```をスキップ
      continue;
    }

    // 水平線
    if (line.match(/^---+$/)) {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });
      i++;
      continue;
    }

    // 通常の段落
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: parseRichText(line),
      },
    });
    i++;
  }

  return blocks;
}

// リッチテキストをパース（リンク、太字、イタリック対応）
function parseRichText(text: string): any[] {
  const richText: any[] = [];
  let remaining = text;

  // 簡易的なパターンマッチング
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/;
  const boldPattern = /\*\*([^*]+)\*\*/;
  const italicPattern = /\*([^*]+)\*/;

  while (remaining.length > 0) {
    const linkMatch = remaining.match(linkPattern);
    const boldMatch = remaining.match(boldPattern);
    const italicMatch = remaining.match(italicPattern);

    // 最も早い位置のマッチを見つける
    const matches = [
      linkMatch ? { type: 'link', match: linkMatch } : null,
      boldMatch ? { type: 'bold', match: boldMatch } : null,
      italicMatch ? { type: 'italic', match: italicMatch } : null,
    ].filter((m) => m !== null);

    if (matches.length === 0) {
      // マッチなし、残りをそのまま追加
      if (remaining.length > 0) {
        richText.push({ type: 'text', text: { content: remaining } });
      }
      break;
    }

    // 最も早い位置のマッチを選択
    const earliest = matches.reduce((a, b) =>
      (a!.match.index || 0) < (b!.match.index || 0) ? a : b
    );

    // マッチ前のテキストを追加
    if (earliest!.match.index! > 0) {
      richText.push({
        type: 'text',
        text: { content: remaining.slice(0, earliest!.match.index) },
      });
    }

    // マッチしたテキストを処理
    if (earliest!.type === 'link') {
      richText.push({
        type: 'text',
        text: { content: earliest!.match[1], link: { url: earliest!.match[2] } },
      });
    } else if (earliest!.type === 'bold') {
      richText.push({
        type: 'text',
        text: { content: earliest!.match[1] },
        annotations: { bold: true },
      });
    } else if (earliest!.type === 'italic') {
      richText.push({
        type: 'text',
        text: { content: earliest!.match[1] },
        annotations: { italic: true },
      });
    }

    remaining = remaining.slice(
      earliest!.match.index! + earliest!.match[0].length
    );
  }

  return richText.length > 0 ? richText : [{ type: 'text', text: { content: text } }];
}

// 記事をNotionページに保存
export async function saveArticleToNotion(
  pageId: string,
  articleContent: string
): Promise<void> {
  return withRetry(async () => {
    const notion = getClient();
    const blocks = markdownToNotionBlocks(articleContent);

    console.log('Notionに記事を保存中...');

    // ブロックを100個ずつに分割して追加（Notion APIの制限）
    const chunkSize = 100;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
    }

    console.log('記事の保存が完了しました');
  }, 'Notion記事保存');
}

// プロパティを更新
export async function updateNotionProperties(
  pageId: string,
  title: string,
  metadata: ArticleMetadata,
  wordCount: number
): Promise<void> {
  return withRetry(async () => {
    const notion = getClient();

    console.log('Notionプロパティを更新中...');

    // 文字数カテゴリを決定
    const wordCountCategory = wordCount >= 4000 ? '4000字' : '3500字';

    const properties: Record<string, any> = {
      [notionPropertyMapping.title]: {
        title: [{ text: { content: title } }],
      },
      [notionPropertyMapping.category]: {
        select: { name: metadata.category },
      },
      [notionPropertyMapping.slug]: {
        rich_text: [{ text: { content: metadata.slug } }],
      },
      [notionPropertyMapping.seoKeywords]: {
        rich_text: [{ text: { content: metadata.seoKeywords.join(', ') } }],
      },
      [notionPropertyMapping.subCategory]: {
        select: { name: metadata.subCategory },
      },
      [notionPropertyMapping.status]: {
        select: { name: 'レビュー中' },
      },
      [notionPropertyMapping.tags]: {
        multi_select: metadata.tags.map((tag) => ({ name: tag })),
      },
      [notionPropertyMapping.targetReaders]: {
        rich_text: [{ text: { content: metadata.targetReaders } }],
      },
      [notionPropertyMapping.themeCategory]: {
        select: { name: metadata.themeCategory },
      },
      [notionPropertyMapping.wordCount]: {
        select: { name: wordCountCategory },
      },
      [notionPropertyMapping.articlePurpose]: {
        rich_text: [{ text: { content: metadata.articlePurpose } }],
      },
      [notionPropertyMapping.readerInsight]: {
        rich_text: [{ text: { content: metadata.readerInsight } }],
      },
    };

    await notion.pages.update({
      page_id: pageId,
      properties,
    });

    console.log('プロパティの更新が完了しました');
  }, 'Notionプロパティ更新');
}

// サムネイルURLを設定
export async function setThumbnailUrl(
  pageId: string,
  imageUrl: string
): Promise<void> {
  return withRetry(async () => {
    const notion = getClient();

    console.log('サムネイルURLを設定中...');

    await notion.pages.update({
      page_id: pageId,
      properties: {
        [notionPropertyMapping.fileMedia]: {
          files: [
            {
              type: 'external',
              name: 'thumbnail.png',
              external: { url: imageUrl },
            },
          ],
        },
      },
    });

    console.log('サムネイルURLの設定が完了しました');
  }, 'サムネイルURL設定');
}

// ローカルにバックアップを保存
export function saveBackup(
  title: string,
  articleContent: string,
  metadata: ArticleMetadata
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupPath = path.join(backupDir, `${timestamp}-backup.json`);
  const backupData = {
    title,
    articleContent,
    metadata,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`バックアップを保存しました: ${backupPath}`);

  return backupPath;
}
