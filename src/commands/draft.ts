import fs from 'fs';
import path from 'path';
import { validateEnv, paths } from '../config/settings';
import { performResearch, generateArticle } from '../services/claude';

export interface DraftOptions {
  title: string;
  output?: string;
}

export interface DraftResult {
  articleContent: string;
  references: string[];
  outputPath?: string;
}

export async function draftCommand(options: DraftOptions): Promise<DraftResult> {
  console.log('\n=== TechTimeブログ下書き生成 ===\n');
  console.log(`タイトル: ${options.title}\n`);

  // 環境変数の検証（draftモードはClaude APIのみ必要）
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY が設定されていません。.envファイルを確認してください。');
  }

  // 記事戦略ガイドを読み込み
  let strategyGuide = '';
  try {
    strategyGuide = fs.readFileSync(paths.strategyGuide, 'utf-8');
    console.log('記事戦略ガイドを読み込みました\n');
  } catch {
    console.log('記事戦略ガイドが見つかりません。デフォルト設定で続行します\n');
  }

  // Step 1: Webリサーチを実行
  console.log('--- Step 1: Webリサーチ ---');
  const researchResult = await performResearch(options.title, strategyGuide);
  console.log('リサーチ完了\n');

  // Step 2: 記事を生成
  console.log('--- Step 2: 記事生成 ---');
  const articleContent = await generateArticle(
    options.title,
    researchResult.content,
    strategyGuide
  );
  console.log('記事生成完了\n');

  // 結果を表示
  console.log('='.repeat(60));
  console.log('生成された記事:');
  console.log('='.repeat(60));
  console.log(articleContent);
  console.log('='.repeat(60));

  // 参考URL一覧を表示
  if (researchResult.references.length > 0) {
    console.log('\n参考URL一覧:');
    researchResult.references.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  }

  // ファイルに保存
  let outputPath: string | undefined;
  if (options.output) {
    outputPath = options.output;
  } else {
    // デフォルトの保存先
    const draftsDir = paths.draftsDir;
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = options.title
      .replace(/[^a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, '_')
      .slice(0, 50);
    outputPath = path.join(draftsDir, `${timestamp}-${safeTitle}.md`);
  }

  fs.writeFileSync(outputPath, articleContent, 'utf-8');
  console.log(`\n下書きを保存しました: ${outputPath}`);

  // 文字数を表示
  const charCount = articleContent.replace(/\s/g, '').length;
  console.log(`文字数: 約${charCount}文字`);

  console.log('\n=== 下書き生成完了 ===');
  console.log('内容を確認し、publishコマンドでNotionに公開してください。');

  return {
    articleContent,
    references: researchResult.references,
    outputPath,
  };
}
