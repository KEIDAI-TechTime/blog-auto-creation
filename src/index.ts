#!/usr/bin/env node

import { Command } from 'commander';
import { draftCommand } from './commands/draft';
import { publishCommand } from './commands/publish';
import { autoCommand } from './commands/auto';
import dotenv from 'dotenv';

// 環境変数を読み込み
dotenv.config();

const program = new Command();

program
  .name('techtime-blog')
  .description('TechTimeブログ記事作成自動化CLIツール')
  .version('1.0.0');

// draftコマンド
program
  .command('draft')
  .description('記事の下書きを生成')
  .requiredOption('-t, --title <title>', '記事タイトル')
  .option('-o, --output <file>', '出力ファイルパス')
  .action(async (options) => {
    try {
      await draftCommand(options);
    } catch (error) {
      console.error('エラーが発生しました:', error);
      process.exit(1);
    }
  });

// publishコマンド
program
  .command('publish')
  .description('記事をNotionに公開し、サムネイルとX投稿文を生成')
  .requiredOption('-t, --title <title>', '記事タイトル')
  .requiredOption('-n, --notion-url <url>', 'NotionページURL')
  .option('-d, --draft-file <file>', '下書きファイルパス')
  .action(async (options) => {
    try {
      await publishCommand(options);
    } catch (error) {
      console.error('エラーが発生しました:', error);
      process.exit(1);
    }
  });

// autoコマンド
program
  .command('auto')
  .description('下書き生成から公開までを一括実行')
  .requiredOption('-t, --title <title>', '記事タイトル')
  .requiredOption('-n, --notion-url <url>', 'NotionページURL')
  .action(async (options) => {
    try {
      await autoCommand(options);
    } catch (error) {
      console.error('エラーが発生しました:', error);
      process.exit(1);
    }
  });

program.parse();
