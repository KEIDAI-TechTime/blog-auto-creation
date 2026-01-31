import { SIMULATOR_URL } from '../config/settings';

export const researchPrompt = (title: string, strategyGuide: string) => `
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

export const articlePrompt = (
  title: string,
  researchResult: string,
  strategyGuide: string
) => `
あなたはTechTimeブログのライターです。以下の調査結果を基に、ブログ記事を執筆してください。

## 記事タイトル
${title}

## 調査結果
${researchResult}

## 記事戦略ガイド
${strategyGuide}

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

export const metadataPrompt = (articleContent: string) => `
以下の記事内容を分析し、Notionプロパティ用のメタデータを生成してください。

## 記事内容
${articleContent}

## 出力形式（JSON）
{
  "category": "カテゴリ（system-dev/management-dx/industry/career/ceo-columnのいずれか）",
  "slug": "URLスラッグ（英数字とハイフンのみ、小文字）",
  "seoKeywords": ["SEOキーワード1", "SEOキーワード2", "SEOキーワード3"],
  "subCategory": "サブカテゴリ",
  "tags": ["タグ1", "タグ2", "タグ3"],
  "targetReaders": "ターゲット読者の説明",
  "themeCategory": "テーマカテゴリ",
  "articlePurpose": "記事で伝えること（50文字以内）",
  "readerInsight": "読者の本音（50文字以内）"
}

JSONのみを出力してください。
`;
