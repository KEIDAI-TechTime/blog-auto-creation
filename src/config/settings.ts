import path from 'path';

// 環境変数の検証
export function validateEnv(): void {
  const requiredEnvVars = [
    'CLAUDE_API_KEY',
    'NOTION_API_KEY',
    'NOTION_DATABASE_ID',
    'GEMINI_API_KEY',
    'IMGBB_API_KEY',
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `以下の環境変数が設定されていません:\n${missing.join('\n')}\n\n.envファイルを確認してください。`
    );
  }
}

// API設定
export const config = {
  claude: {
    apiKey: process.env.CLAUDE_API_KEY || '',
    model: 'claude-sonnet-4-20250514',
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    databaseId: process.env.NOTION_DATABASE_ID || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'imagen-3.0-generate-002',  // 画像生成用モデル
  },
  imgbb: {
    apiKey: process.env.IMGBB_API_KEY || '',
  },
};

// Notionプロパティマッピング
export const notionPropertyMapping = {
  title: '名前',
  category: 'Category', // system-dev, management-dx, industry, career, ceo-column
  slug: 'Slug',
  seoKeywords: 'SEOキーワード',
  subCategory: 'サブカテゴリ',
  status: 'ステータス', // アイデア, 企画中, 執筆中, レビュー中, 公開済
  tags: 'タグ',
  targetReaders: 'ターゲット読者',
  themeCategory: 'テーマカテゴリ',
  wordCount: '想定文字数', // 3500字, 4000字
  fileMedia: 'ファイル&メディア',
  articlePurpose: '記事で伝えること',
  readerInsight: '読者の本音',
};

// カテゴリオプション
export const categoryOptions = [
  'system-dev',
  'management-dx',
  'industry',
  'career',
  'ceo-column',
] as const;

// ステータスオプション
export const statusOptions = [
  'アイデア',
  '企画中',
  '執筆中',
  'レビュー中',
  '公開済',
] as const;

// 文字数オプション
export const wordCountOptions = ['3500字', '4000字'] as const;

// パス設定
export const paths = {
  strategyGuide: path.join(__dirname, 'strategy.md'),
  draftsDir: path.join(process.cwd(), 'drafts'),
};

// リトライ設定
export const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
};

// シミュレーターURL
export const SIMULATOR_URL = 'https://techtime-jp.com/simulator';
