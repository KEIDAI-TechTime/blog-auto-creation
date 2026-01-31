import fs from 'fs';
import { validateEnv } from '../config/settings';
import {
  generateMetadataWithOptions,
  generateThumbnailInfo,
  generateXPost,
} from '../services/claude';
import {
  getDatabaseOptions,
  saveArticleToNotion,
  updateNotionProperties,
  setCoverImageUrl,
  saveBackup,
} from '../services/notion';
import { generateThumbnailImage } from '../services/gemini';
import { uploadToImgbb } from '../services/imgbb';

export interface PublishOptions {
  title: string;
  notionPageId: string;
  articleFile: string;
}

export interface PublishResult {
  notionPageId: string;
  thumbnailUrl: string;
  xPost: string;
}

// タイトルをMarkdownの最初の見出しから抽出
function extractTitleFromMarkdown(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    // # で始まる見出しを探す
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return 'Untitled';
}

export async function publishCommand(
  options: PublishOptions
): Promise<PublishResult> {
  console.log('\n=== TechTimeブログ公開処理 ===\n');

  // 環境変数の検証
  validateEnv();

  // Step 1: 記事ファイルを読み込み
  console.log('--- Step 1: 記事読み込み ---');
  if (!fs.existsSync(options.articleFile)) {
    throw new Error(`記事ファイルが見つかりません: ${options.articleFile}`);
  }

  const articleContent = fs.readFileSync(options.articleFile, 'utf-8');
  const wordCount = articleContent.replace(/\s/g, '').length;

  // タイトルを抽出（オプションで指定されていない場合はMarkdownから）
  const title = options.title || extractTitleFromMarkdown(articleContent);

  console.log(`タイトル: ${title}`);
  console.log(`文字数: ${wordCount}文字`);
  console.log(`Notion ページID: ${options.notionPageId}\n`);

  // Step 2: Notionから既存オプションを取得
  console.log('--- Step 2: 既存オプション取得 ---');
  const dbOptions = await getDatabaseOptions();
  console.log('');

  // Step 3: メタデータを生成（既存オプションから選択）
  console.log('--- Step 3: メタデータ生成 ---');
  const metadata = await generateMetadataWithOptions(articleContent, title, dbOptions);
  console.log('メタデータ:', JSON.stringify(metadata, null, 2), '\n');

  // Step 4: Notionに記事を保存
  console.log('--- Step 4: Notion保存 ---');
  try {
    await saveArticleToNotion(options.notionPageId, articleContent);
    await updateNotionProperties(options.notionPageId, title, metadata, wordCount);
  } catch (error) {
    console.error('Notion保存に失敗しました。バックアップを作成します...');
    const backupPath = saveBackup(title, articleContent, metadata);
    console.log(`バックアップ: ${backupPath}`);
    throw error;
  }
  console.log('');

  // Step 5: サムネイル情報を生成
  console.log('--- Step 5: サムネイル情報生成 ---');
  const thumbnailInfo = await generateThumbnailInfo(title, articleContent);
  console.log('サムネイル情報:', JSON.stringify(thumbnailInfo, null, 2), '\n');

  // Step 6: サムネイル画像を生成
  console.log('--- Step 6: サムネイル画像生成 ---');
  const thumbnailResult = await generateThumbnailImage(
    thumbnailInfo.mainTitle,
    thumbnailInfo.subTitle,
    thumbnailInfo.backgroundTheme
  );
  console.log('');

  // Step 7: imgbbにアップロード
  console.log('--- Step 7: imgbbアップロード ---');
  const imgbbResult = await uploadToImgbb(
    thumbnailResult.imageData,
    `techtime-${metadata.slug}`
  );
  console.log(`画像URL: ${imgbbResult.url}\n`);

  // Step 8: Notionにカバー画像URLを設定
  console.log('--- Step 8: カバー画像設定 ---');
  await setCoverImageUrl(options.notionPageId, imgbbResult.url);
  console.log('');

  // Step 9: X投稿文を生成
  console.log('--- Step 9: X投稿文生成 ---');
  const xPost = await generateXPost(articleContent);
  console.log('');

  // 結果を表示
  console.log('='.repeat(60));
  console.log('公開処理完了!');
  console.log('='.repeat(60));
  console.log(`\nNotion ページID: ${options.notionPageId}`);
  console.log(`サムネイルURL: ${imgbbResult.url}`);
  console.log(`\nX投稿文（${xPost.length}文字）:`);
  console.log('-'.repeat(40));
  console.log(xPost);
  console.log('-'.repeat(40));

  console.log('\n=== 公開処理完了 ===');

  return {
    notionPageId: options.notionPageId,
    thumbnailUrl: imgbbResult.url,
    xPost,
  };
}
