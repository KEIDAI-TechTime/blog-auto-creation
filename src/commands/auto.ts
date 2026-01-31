import * as readline from 'readline';
import { draftCommand } from './draft';
import { publishCommand } from './publish';
import { validateEnv } from '../config/settings';

export interface AutoOptions {
  title: string;
  notionUrl: string;
}

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes' || normalized === 'はい');
    });
  });
}

export async function autoCommand(options: AutoOptions): Promise<void> {
  console.log('\n=== TechTimeブログ一括実行モード ===\n');
  console.log(`タイトル: ${options.title}`);
  console.log(`Notion URL: ${options.notionUrl}\n`);

  // 環境変数の検証
  validateEnv();

  // Step 1: 下書き生成
  console.log('>>> Phase 1: 下書き生成\n');
  const draftResult = await draftCommand({
    title: options.title,
  });

  // 確認プロンプト
  console.log('\n');
  const confirmed = await askConfirmation(
    '上記の内容でNotionに公開しますか？ (y/n): '
  );

  if (!confirmed) {
    console.log('\n公開をキャンセルしました。');
    console.log(`下書きは以下に保存されています: ${draftResult.outputPath}`);
    console.log(
      '\n手動で公開する場合は以下のコマンドを使用してください:'
    );
    console.log(
      `  npx techtime-blog publish --title "${options.title}" --notion-url "${options.notionUrl}" --draft-file "${draftResult.outputPath}"`
    );
    return;
  }

  // Step 2: 公開処理
  console.log('\n>>> Phase 2: 公開処理\n');
  const publishResult = await publishCommand({
    title: options.title,
    notionUrl: options.notionUrl,
    draftFile: draftResult.outputPath,
  });

  // 最終結果
  console.log('\n' + '='.repeat(60));
  console.log('一括実行完了!');
  console.log('='.repeat(60));
  console.log(`\nNotion URL: ${publishResult.notionUrl}`);
  console.log(`サムネイルURL: ${publishResult.thumbnailUrl}`);
  console.log(`\nX投稿文:`);
  console.log('-'.repeat(40));
  console.log(publishResult.xPost);
  console.log('-'.repeat(40));

  console.log('\n=== 一括実行完了 ===');
}
