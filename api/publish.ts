import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Notion ページIDを抽出
function extractPageId(notionUrl: string): string {
  const patterns = [
    /([a-f0-9]{32})(?:\?|$)/i,
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\?|$)/i,
    /-([a-f0-9]{32})(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = notionUrl.match(pattern);
    if (match) {
      return match[1].replace(/-/g, '');
    }
  }

  throw new Error(`無効なNotionページURL: ${notionUrl}`);
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title, notionUrl, articleContent } = req.body;

    if (!title || !notionUrl || !articleContent) {
      return res.status(400).json({
        error: 'title, notionUrl, articleContent は必須です'
      });
    }

    // 環境変数チェック
    if (!process.env.CLAUDE_API_KEY || !process.env.NOTION_API_KEY ||
        !process.env.GEMINI_API_KEY || !process.env.IMGBB_API_KEY) {
      return res.status(500).json({ error: 'APIキーが設定されていません' });
    }

    const pageId = extractPageId(notionUrl);
    const wordCount = articleContent.replace(/\s/g, '').length;

    // Notion クライアント
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    // Step 1: メタデータ生成
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const metadataResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `以下の記事内容を分析し、Notionプロパティ用のメタデータを生成してください。

## 記事内容
${articleContent.slice(0, 3000)}

## 出力形式（JSON）
{
  "category": "カテゴリ（system-dev/management-dx/industry/career/ceo-columnのいずれか）",
  "slug": "URLスラッグ（英数字とハイフンのみ、小文字）",
  "seoKeywords": ["SEOキーワード1", "SEOキーワード2", "SEOキーワード3"],
  "subCategory": "サブカテゴリ",
  "tags": ["タグ1", "タグ2", "タグ3"],
  "targetReaders": "ターゲット読者の説明"
}

JSONのみを出力してください。`
      }],
    });

    let metadataContent = '';
    for (const block of metadataResponse.content) {
      if (block.type === 'text') {
        metadataContent += block.text;
      }
    }
    const jsonMatch = metadataContent.match(/\{[\s\S]*\}/);
    const metadata = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    // Step 2: Notion に記事保存
    const blocks = markdownToNotionBlocks(articleContent);
    const chunkSize = 100;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
    }

    // Step 3: プロパティ更新
    await notion.pages.update({
      page_id: pageId,
      properties: {
        '名前': { title: [{ text: { content: title } }] },
        'Category': { select: { name: metadata.category || 'industry' } },
        'Slug': { rich_text: [{ text: { content: metadata.slug || '' } }] },
        'SEOキーワード': { rich_text: [{ text: { content: (metadata.seoKeywords || []).join(', ') } }] },
        'ステータス': { select: { name: 'レビュー中' } },
        'タグ': { multi_select: (metadata.tags || []).map((tag: string) => ({ name: tag })) },
        '想定文字数': { select: { name: wordCount >= 4000 ? '4000字' : '3500字' } },
      },
    });

    // Step 4: サムネイル情報生成
    const thumbnailInfoResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `以下の記事タイトルに基づき、サムネイル画像生成用の情報を作成してください。

## 記事タイトル
${title}

## 出力形式（JSON）
{
  "mainTitle": "メインタイトル（2行に分けて）",
  "subTitle": "サブタイトル（20文字以内）",
  "backgroundTheme": "背景テーマ（英語で）"
}

JSONのみを出力してください。`
      }],
    });

    let thumbnailInfoContent = '';
    for (const block of thumbnailInfoResponse.content) {
      if (block.type === 'text') {
        thumbnailInfoContent += block.text;
      }
    }
    const thumbnailJsonMatch = thumbnailInfoContent.match(/\{[\s\S]*\}/);
    const thumbnailInfo = thumbnailJsonMatch ? JSON.parse(thumbnailJsonMatch[0]) : {
      mainTitle: title,
      subTitle: '',
      backgroundTheme: 'modern office workspace'
    };

    // Step 5: Gemini で画像生成
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const titleLines = thumbnailInfo.mainTitle.split('\n');
    const thumbnailPrompt = `A wide horizontal image (1280x720 aspect ratio) for a blog thumbnail. The background shows ${thumbnailInfo.backgroundTheme}, with a strong blue color grading, heavy blur/depth of field effect, and dim atmospheric lighting with scattered light source highlights. In the center of the image, place a dark charcoal semi-transparent rectangular box, tilted at approximately 5 degrees to the left, with a thin green border line around it. Inside the box, display white bold Japanese text in two lines at the top reading "${titleLines[0] || ''}" on the first line and "${titleLines[1] || ''}" on the second line. At the bottom of the box, display smaller white thin Japanese text reading "${thumbnailInfo.subTitle}". Professional, modern blog thumbnail style.`;

    const imageResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: thumbnailPrompt }] }],
      generationConfig: { responseModalities: ['image', 'text'] } as any,
    });

    let imageData: Buffer | null = null;
    const candidates = imageResult.response.candidates;
    if (candidates && candidates.length > 0) {
      for (const candidate of candidates) {
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if ('inlineData' in part && part.inlineData) {
              imageData = Buffer.from(part.inlineData.data, 'base64');
              break;
            }
          }
        }
      }
    }

    let thumbnailUrl = '';
    if (imageData) {
      // Step 6: imgbb にアップロード
      const formData = new URLSearchParams();
      formData.append('key', process.env.IMGBB_API_KEY);
      formData.append('image', imageData.toString('base64'));
      formData.append('name', `techtime-${metadata.slug || 'thumbnail'}`);

      const imgbbResponse = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData,
      });

      const imgbbResult = await imgbbResponse.json() as { success: boolean; data: { url: string } };
      if (imgbbResult.success) {
        thumbnailUrl = imgbbResult.data.url;

        // Notion にサムネイル URL 設定
        await notion.pages.update({
          page_id: pageId,
          properties: {
            'ファイル&メディア': {
              files: [{ type: 'external', name: 'thumbnail.png', external: { url: thumbnailUrl } }],
            },
          },
        });
      }
    }

    // Step 7: X 投稿文生成
    const xPostResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `以下の記事内容に基づき、140文字以内でX投稿文を作成してください。

## 条件
- 記事紹介ではなく、伝えたいことを140文字で完結させる
- 冒頭で意外性・逆説を提示してフックを作る
- 最後に教訓・主張を入れる

## 記事内容
${articleContent.slice(0, 2000)}

X投稿文のみを出力してください（140文字以内）。`
      }],
    });

    let xPost = '';
    for (const block of xPostResponse.content) {
      if (block.type === 'text') {
        xPost += block.text;
      }
    }
    if (xPost.length > 140) {
      xPost = xPost.slice(0, 137) + '...';
    }

    res.json({
      success: true,
      notionUrl,
      thumbnailUrl,
      xPost: xPost.trim(),
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
}
