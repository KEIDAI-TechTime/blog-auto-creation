import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Notion プロパティマッピング
const notionPropertyMapping = {
  category: 'Category',
  subCategory: 'サブカテゴリ',
  themeCategory: 'テーマカテゴリ',
  tags: 'タグ',
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
  if (properties[notionPropertyMapping.subCategory]?.select?.options) {
    for (const opt of properties[notionPropertyMapping.subCategory].select.options) {
      subCategories.push(opt.name);
    }
  }

  const themeCategories: string[] = [];
  if (properties[notionPropertyMapping.themeCategory]?.select?.options) {
    for (const opt of properties[notionPropertyMapping.themeCategory].select.options) {
      themeCategories.push(opt.name);
    }
  }

  const tags: string[] = [];
  if (properties[notionPropertyMapping.tags]?.multi_select?.options) {
    for (const opt of properties[notionPropertyMapping.tags].multi_select.options) {
      tags.push(opt.name);
    }
  }

  return { categories, subCategories, themeCategories, tags };
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

    // Notion クライアント
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    // Step 1: 既存オプション取得
    console.log('Step 1: 既存オプション取得');
    const options = await getDatabaseOptions(notion, process.env.NOTION_DATABASE_ID);

    // Step 2: メタデータ生成
    console.log('Step 2: メタデータ生成');
    const metadataPrompt = `以下の記事内容を分析し、Notionプロパティ用のメタデータを生成してください。

【重要】カテゴリ、サブカテゴリ、テーマカテゴリ、タグは、必ず以下の既存オプションから選択してください。新しい値を創作しないでください。

## 既存オプション

### カテゴリ（1つ選択）
${options.categories.join(', ')}

### サブカテゴリ（1つ選択）
${options.subCategories.join(', ')}

### テーマカテゴリ（1つ選択）
${options.themeCategories.join(', ')}

### タグ（1-5個選択）
${options.tags.join(', ')}

## 記事タイトル
${title}

## 記事内容
${articleContent.slice(0, 4000)}

## 出力形式（JSON）
{
  "category": "上記カテゴリから1つ選択",
  "slug": "URLスラッグ（英数字とハイフンのみ、小文字、タイトルから生成）",
  "seoKeywords": ["SEOキーワード1", "SEOキーワード2", "SEOキーワード3"],
  "subCategories": ["上記サブカテゴリから1つ選択"],
  "tags": ["上記タグから1-5個選択"],
  "themeCategories": ["上記テーマカテゴリから1つ選択"]
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

    // Step 3: サムネイル情報生成
    console.log('Step 3: サムネイル情報生成');
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

    // Step 4: Gemini で画像生成
    console.log('Step 4: Gemini で画像生成');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // 画像生成には gemini-3-pro-image-preview を使用
    const model = genAI.getGenerativeModel({ model: 'gemini-3-pro-image-preview' });

    const titleLines = thumbnailInfo.mainTitle.split('\n');
    const thumbnailPrompt = `A wide horizontal image (1280x720 aspect ratio) for a blog thumbnail. The background shows ${thumbnailInfo.backgroundTheme}, with a strong blue color grading, heavy blur/depth of field effect, and dim atmospheric lighting with scattered light source highlights. In the center of the image, place a dark charcoal semi-transparent rectangular box, tilted at approximately 5 degrees to the left, with a thin green border line around it. Inside the box, display white bold Japanese text in two lines at the top reading "${titleLines[0] || ''}" on the first line and "${titleLines[1] || ''}" on the second line. At the bottom of the box, display smaller white thin Japanese text reading "${thumbnailInfo.subTitle}". Professional, modern blog thumbnail style.`;

    console.log('Generating image with prompt:', thumbnailPrompt.slice(0, 100) + '...');

    const imageResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: thumbnailPrompt }] }],
      generationConfig: { responseModalities: ['image', 'text'] } as any,
    });

    console.log('Gemini response received, extracting image...');

    let imageData: Buffer | null = null;
    const candidates = imageResult.response.candidates;
    console.log('Candidates count:', candidates?.length || 0);

    if (candidates && candidates.length > 0) {
      for (const candidate of candidates) {
        if (candidate.content && candidate.content.parts) {
          console.log('Parts count:', candidate.content.parts.length);
          for (const part of candidate.content.parts) {
            console.log('Part type:', Object.keys(part));
            if ('inlineData' in part && part.inlineData) {
              console.log('Found inlineData, mimeType:', part.inlineData.mimeType);
              imageData = Buffer.from(part.inlineData.data, 'base64');
              break;
            }
          }
        }
      }
    }

    let thumbnailUrl = '';
    if (imageData) {
      // Step 5: imgbb にアップロード
      console.log('Step 5: imgbb にアップロード, image size:', imageData.length, 'bytes');
      const formData = new URLSearchParams();
      formData.append('key', process.env.IMGBB_API_KEY!);
      formData.append('image', imageData.toString('base64'));
      formData.append('name', `techtime-${metadata.slug || 'thumbnail'}`);

      const imgbbResponse = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData,
      });

      const imgbbResult = await imgbbResponse.json() as { success: boolean; data: { url: string }; error?: { message: string } };
      console.log('imgbb response:', JSON.stringify(imgbbResult).slice(0, 200));

      if (imgbbResult.success) {
        thumbnailUrl = imgbbResult.data.url;
        console.log('imgbb upload success:', thumbnailUrl);
      } else {
        console.error('imgbb upload failed:', imgbbResult.error?.message || 'Unknown error');
      }
    } else {
      console.warn('No image data generated from Gemini');
    }

    // Step 6: X 投稿文生成
    console.log('Step 6: X 投稿文生成');
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
      title,
      metadata,
      thumbnailUrl,
      xPost: xPost.trim(),
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
}
