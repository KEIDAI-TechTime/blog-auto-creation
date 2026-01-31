import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

// 既存のオプション取得
async function getDatabaseOptions(notion: Client, databaseId: string) {
  const database = await notion.databases.retrieve({
    database_id: databaseId,
  }) as any;

  const properties = database.properties;

  const categories: string[] = [];
  if (properties[notionPropertyMapping.category]?.select?.options) {
    for (const opt of properties[notionPropertyMapping.category].select.options) {
      categories.push(opt.name);
    }
  }

  const subCategories: string[] = [];
  if (properties[notionPropertyMapping.subCategory]?.multi_select?.options) {
    for (const opt of properties[notionPropertyMapping.subCategory].multi_select.options) {
      subCategories.push(opt.name);
    }
  }

  const themeCategories: string[] = [];
  if (properties[notionPropertyMapping.themeCategory]?.multi_select?.options) {
    for (const opt of properties[notionPropertyMapping.themeCategory].multi_select.options) {
      themeCategories.push(opt.name);
    }
  }

  const tags: string[] = [];
  if (properties[notionPropertyMapping.tags]?.multi_select?.options) {
    for (const opt of properties[notionPropertyMapping.tags].multi_select.options) {
      tags.push(opt.name);
    }
  }

  const targetReaders: string[] = [];
  if (properties[notionPropertyMapping.targetReaders]?.multi_select?.options) {
    for (const opt of properties[notionPropertyMapping.targetReaders].multi_select.options) {
      targetReaders.push(opt.name);
    }
  }

  return { categories, subCategories, themeCategories, tags, targetReaders };
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

// タイトルをMarkdownから抽出
function extractTitleFromMarkdown(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return 'Untitled';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title: inputTitle, notionPageId, articleContent } = req.body;

    if (!notionPageId || !articleContent) {
      return res.status(400).json({
        error: 'notionPageId, articleContent は必須です'
      });
    }

    // 環境変数チェック
    if (!process.env.CLAUDE_API_KEY || !process.env.NOTION_API_KEY ||
        !process.env.NOTION_DATABASE_ID || !process.env.GEMINI_API_KEY ||
        !process.env.IMGBB_API_KEY) {
      return res.status(500).json({ error: 'APIキーが設定されていません' });
    }

    const title = inputTitle || extractTitleFromMarkdown(articleContent);
    const wordCount = articleContent.replace(/\s/g, '').length;

    // Notion クライアント
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    // Step 1: 既存オプション取得
    console.log('Step 1: 既存オプション取得');
    const options = await getDatabaseOptions(notion, process.env.NOTION_DATABASE_ID);

    // Step 2: メタデータ生成（既存オプションから選択）
    console.log('Step 2: メタデータ生成');
    const metadataPrompt = `以下の記事内容を分析し、Notionプロパティ用のメタデータを生成してください。

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
${articleContent.slice(0, 4000)}

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

    const metadataResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: metadataPrompt }],
    });

    let metadataContent = '';
    for (const block of metadataResponse.content) {
      if (block.type === 'text') {
        metadataContent += block.text;
      }
    }
    const jsonMatch = metadataContent.match(/\{[\s\S]*\}/);
    const metadata = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    // オプションの検証
    if (!options.categories.includes(metadata.category)) {
      metadata.category = options.categories[0] || 'career';
    }
    metadata.subCategories = (metadata.subCategories || []).filter((sc: string) => options.subCategories.includes(sc));
    metadata.themeCategories = (metadata.themeCategories || []).filter((tc: string) => options.themeCategories.includes(tc));
    metadata.tags = (metadata.tags || []).filter((tag: string) => options.tags.includes(tag));
    metadata.targetReaders = (metadata.targetReaders || []).filter((tr: string) => options.targetReaders.includes(tr));

    // Step 3: Notion に記事保存
    console.log('Step 3: Notion に記事保存');
    const blocks = markdownToNotionBlocks(articleContent);
    const chunkSize = 100;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await notion.blocks.children.append({
        block_id: notionPageId,
        children: chunk,
      });
    }

    // Step 4: プロパティ更新
    console.log('Step 4: プロパティ更新');
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

    // Step 5: サムネイル情報生成
    console.log('Step 5: サムネイル情報生成');
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
  "mainTitle": "メインタイトル（2行に分けて、\\nで区切る）",
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

    // Step 6: Gemini で画像生成
    console.log('Step 6: Gemini で画像生成');
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
      // Step 7: imgbb にアップロード
      console.log('Step 7: imgbb にアップロード');
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

        // Step 8: Notion にカバー画像を設定
        console.log('Step 8: Notion にカバー画像を設定');
        await notion.pages.update({
          page_id: notionPageId,
          cover: {
            type: 'external',
            external: { url: thumbnailUrl },
          },
        });
      }
    }

    // Step 9: X 投稿文生成
    console.log('Step 9: X 投稿文生成');
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
      notionPageId,
      thumbnailUrl,
      xPost: xPost.trim(),
      metadata,
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
}
