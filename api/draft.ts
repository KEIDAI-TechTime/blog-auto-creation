import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const SIMULATOR_URL = 'https://techtime-jp.com/simulator';

const researchPrompt = (title: string) => `
あなたはTechTimeブログの調査担当者です。以下のタイトルについて、最新の情報を調査してください。

## 調査タイトル
${title}

## 調査項目
1. トピックの現状と最新トレンド
2. 主要な統計データ・数値
3. 業界の課題・問題点
4. 成功事例・失敗事例
5. 専門家の見解・意見
6. 関連する法規制・ガイドライン

## 出力形式
調査結果を以下の形式で出力してください：

### 調査サマリー
（3-5行で要点をまとめる）

### 詳細調査結果
（各項目について詳細に記述）

### 参考URL一覧
（調査に使用した情報源をリスト化）

### 記事で使えるデータポイント
（具体的な数字・事例を箇条書き）
`;

const articlePrompt = (title: string, researchResult: string) => `
あなたはTechTimeブログのライターです。以下の調査結果を基に、ブログ記事を執筆してください。

## 記事タイトル
${title}

## 調査結果
${researchResult}

## 執筆ルール
1. 冒頭に「この記事のポイント」として3点要約を配置
2. 重要なデータやリスクにはcalloutを使用
3. 末尾に「まとめ」として3点を配置し、シミュレーターへの誘導を含める
4. シミュレーターURL: ${SIMULATOR_URL}
5. 内部ラベル（【中間誘導】等）は含めない
6. 専門的だが読みやすいトーンで
7. 具体的な数字・固有名詞を使用
8. 批判だけでなく解決策も提示

## 記事構成
1. 導入（キャッチーな問題提起）
2. 表向きの成功・現状
3. 裏側の課題・問題点
4. 原因分析
5. 解決策・あるべき姿
6. TechTimeの提案（シミュレーター誘導）
7. まとめ

## 出力形式
Markdown形式で記事本文のみを出力してください。
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'タイトルは必須です' });
    }

    if (!process.env.CLAUDE_API_KEY) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY が設定されていません' });
    }

    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    // Step 1: Webリサーチ
    console.log('Webリサーチを実行中...');
    const researchResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
        } as any,
      ],
      messages: [
        {
          role: 'user',
          content: researchPrompt(title),
        },
      ],
    });

    let researchContent = '';
    for (const block of researchResponse.content) {
      if (block.type === 'text') {
        researchContent += block.text;
      }
    }

    // Step 2: 記事生成
    console.log('記事を生成中...');
    const articleResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: articlePrompt(title, researchContent),
        },
      ],
    });

    let articleContent = '';
    for (const block of articleResponse.content) {
      if (block.type === 'text') {
        articleContent += block.text;
      }
    }

    // 参考URLを抽出
    const urlPattern = /https?:\/\/[^\s\)]+/g;
    const matches = researchContent.match(urlPattern);
    const references = matches ? [...new Set(matches)] : [];

    res.json({
      success: true,
      articleContent,
      references,
    });
  } catch (error) {
    console.error('Draft error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
}
