#!/usr/bin/env node

import { Command } from 'commander';
import { publishCommand } from './commands/publish';
import dotenv from 'dotenv';

// 環境変数を読み込み
dotenv.config();

const program = new Command();

program
  .name('techtime-blog')
  .description('TechTimeブログ記事公開自動化CLIツール')
  .version('2.0.0');

// publishコマンド
program
  .command('publish')
  .description('記事をNotionに公開し、サムネイルとX投稿文を生成')
  .requiredOption('-f, --file <file>', '記事Markdownファイルパス')
  .requiredOption('-p, --page-id <pageId>', 'NotionページID')
  .option('-t, --title <title>', '記事タイトル（省略時はMarkdownから抽出）')
  .action(async (options) => {
    try {
      await publishCommand({
        title: options.title || '',
        notionPageId: options.pageId,
        articleFile: options.file,
      });
    } catch (error) {
      console.error('エラーが発生しました:', error);
      process.exit(1);
    }
  });

program.parse();
