import fs from 'fs';
import { validateEnv } from '../config/settings';
import {
  generateMetadata,
  generateThumbnailInfo,
  generateXPost,
} from '../services/claude';
import {
  extractPageId,
  saveArticleToNotion,
  updateNotionProperties,
  setThumbnailUrl,
  saveBackup,
} from '../services/notion';
import { generateThumbnailImage } from '../services/gemini';
import { uploadToImgbb } from '../services/imgbb';

export interface PublishOptions {
  title: string;
  notionUrl: string;
  draftFile?: string;
}

export interface PublishResult {
  notionUrl: string;
  thumbnailUrl: string;
  xPost: string;
}

export async function publishCommand(
  options: PublishOptions
): Promise<PublishResult> {
  console.log('\n=== TechTimeブログ公開処理 ===\n');
  console.log(`タイトル: ${options.title}`);
  console.log(`Notion URL: ${options.notionUrl}\n`);

  // 環境変数の検証
  validateEnv();

  // Step 1: 下書きファイルを読み込み
  console.log('--- Step 1: 下書き読み込み ---');
  if (!options.draftFile) {
    throw new Error(
      '下書きファイルパス（--draft-file）を指定してください'
    );
  }

  if (!fs.existsSync(options.draftFile)) {
    throw new Error(`下書きファイルが見つかりません: ${options.draftFile}`);
  }

  const articleContent = fs.readFileSync(options.draftFile, 'utf-8');
  const wordCount = articleContent.replace(/\s/g, '').length;
  console.log(`下書きを読み込みました（${wordCount}文字）\n`);

  // ページIDを抽出
  const pageId = extractPageId(options.notionUrl);
  console.log(`ページID: ${pageId}\n`);

  // Step 2: メタデータを生成
  console.log('--- Step 2: メタデータ生成 ---');
  const metadata = await generateMetadata(articleContent);
  console.log('メタデータ:', JSON.stringify(metadata, null, 2), '\n');

  // Step 3: Notionに記事を保存
  console.log('--- Step 3: Notion保存 ---');
  try {
    await saveArticleToNotion(pageId, articleContent);
    await updateNotionProperties(pageId, options.title, metadata, wordCount);
  } catch (error) {
    console.error('Notion保存に失敗しました。バックアップを作成します...');
    const backupPath = saveBackup(options.title, articleContent, metadata);
    console.log(`バックアップ: ${backupPath}`);
    throw error;
  }
  console.log('');

  // Step 4: サムネイル情報を生成
  console.log('--- Step 4: サムネイル情報生成 ---');
  const thumbnailInfo = await generateThumbnailInfo(options.title, articleContent);
  console.log('サムネイル情報:', JSON.stringify(thumbnailInfo, null, 2), '\n');

  // Step 5: サムネイル画像を生成
  console.log('--- Step 5: サムネイル画像生成 ---');
  const thumbnailResult = await generateThumbnailImage(
    thumbnailInfo.mainTitle,
    thumbnailInfo.subTitle,
    thumbnailInfo.backgroundTheme
  );
  console.log('');

  // Step 6: imgbbにアップロード
  console.log('--- Step 6: imgbbアップロード ---');
  const imgbbResult = await uploadToImgbb(
    thumbnailResult.imageData,
    `techtime-${metadata.slug}`
  );
  console.log(`画像URL: ${imgbbResult.url}\n`);

  // Step 7: NotionにサムネイルURLを設定
  console.log('--- Step 7: サムネイルURL設定 ---');
  await setThumbnailUrl(pageId, imgbbResult.url);
  console.log('');

  // Step 8: X投稿文を生成
  console.log('--- Step 8: X投稿文生成 ---');
  const xPost = await generateXPost(articleContent);
  console.log('');

  // 結果を表示
  console.log('='.repeat(60));
  console.log('公開処理完了!');
  console.log('='.repeat(60));
  console.log(`\nNotion URL: ${options.notionUrl}`);
  console.log(`サムネイルURL: ${imgbbResult.url}`);
  console.log(`\nX投稿文（${xPost.length}文字）:`);
  console.log('-'.repeat(40));
  console.log(xPost);
  console.log('-'.repeat(40));

  console.log('\n=== 公開処理完了 ===');

  return {
    notionUrl: options.notionUrl,
    thumbnailUrl: imgbbResult.url,
    xPost,
  };
}
