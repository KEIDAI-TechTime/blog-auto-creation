import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from '@notionhq/client';

// Notion プロパティマッピング
const notionPropertyMapping = {
  title: '名前',
  category: 'Category',
  slug: 'Slug',
  seoKeywords: 'SEOキーワード',
  subCategory: 'サブカテゴリ',
  status: 'ステータス',
  tags: 'タグ',
  targetReaders: 'ターゲット読者',
  themeCategory: 'テーマカテゴリ',
  wordCount: '想定文字数',
};

// Markdown を Notion ブロックに変換
function markdownToNotionBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('> ')) {
      const calloutLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        calloutLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: calloutLines.join('\n') } }],
          icon: { emoji: '💡' },
        },
      });
      continue;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }],
        },
      });
    }
    i++;
  }

  return blocks;
}

// NotionページIDを正規化（ハイフンなし32文字に変換）
function normalizePageId(pageId: string): string {
  // ハイフンを除去して小文字に
  const cleaned = pageId.replace(/-/g, '').toLowerCase();
  // 32文字でなければエラー
  if (cleaned.length !== 32 || !/^[a-f0-9]+$/.test(cleaned)) {
    throw new Error(`無効なNotionページID: ${pageId}`);
  }
  return cleaned;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { notionPageId: rawPageId, title, articleContent, metadata, thumbnailUrl } = req.body;

    if (!rawPageId || !articleContent || !metadata) {
      return res.status(400).json({
        error: 'notionPageId, articleContent, metadata は必須です'
      });
    }

    // ページIDを正規化
    const notionPageId = normalizePageId(rawPageId);
    console.log('Normalized page ID:', notionPageId);

    // 環境変数チェック
    if (!process.env.NOTION_API_KEY) {
      return res.status(500).json({ error: 'NOTION_API_KEY が設定されていません' });
    }

    const wordCount = articleContent.replace(/\s/g, '').length;

    // Notion クライアント
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    // Step 1: Notion に記事保存
    console.log('Step 1: Notion に記事保存');
    const blocks = markdownToNotionBlocks(articleContent);
    const chunkSize = 100;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await notion.blocks.children.append({
        block_id: notionPageId,
        children: chunk,
      });
    }

    // Step 2: プロパティ更新
    console.log('Step 2: プロパティ更新');
    await notion.pages.update({
      page_id: notionPageId,
      properties: {
        [notionPropertyMapping.title]: { title: [{ text: { content: title } }] },
        [notionPropertyMapping.category]: { select: { name: metadata.category } },
        [notionPropertyMapping.slug]: { rich_text: [{ text: { content: metadata.slug || '' } }] },
        [notionPropertyMapping.seoKeywords]: { rich_text: [{ text: { content: (metadata.seoKeywords || []).join(', ') } }] },
        [notionPropertyMapping.subCategory]: { multi_select: (metadata.subCategories || []).map((sc: string) => ({ name: sc })) },
        [notionPropertyMapping.status]: { select: { name: 'レビュー中' } },
        [notionPropertyMapping.tags]: { multi_select: (metadata.tags || []).map((tag: string) => ({ name: tag })) },
        [notionPropertyMapping.targetReaders]: { multi_select: (metadata.targetReaders || []).map((tr: string) => ({ name: tr })) },
        [notionPropertyMapping.themeCategory]: { multi_select: (metadata.themeCategories || []).map((tc: string) => ({ name: tc })) },
        [notionPropertyMapping.wordCount]: { select: { name: wordCount >= 4000 ? '4000字' : '3500字' } },
      },
    });

    // Step 3: カバー画像を設定
    if (thumbnailUrl) {
      console.log('Step 3: カバー画像を設定');
      await notion.pages.update({
        page_id: notionPageId,
        cover: {
          type: 'external',
          external: { url: thumbnailUrl },
        },
      });
    }

    res.json({
      success: true,
      notionPageId,
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
}
