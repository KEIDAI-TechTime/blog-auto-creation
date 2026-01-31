import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { publishCommand } from './commands/publish';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// APIエンドポイント: 公開
app.post('/api/publish', async (req, res) => {
  try {
    const { title, notionPageId, articleContent } = req.body;

    if (!notionPageId || !articleContent) {
      return res.status(400).json({
        error: 'notionPageId, articleContent は必須です'
      });
    }

    console.log(`[API] Publish開始: ${title || '(タイトル自動抽出)'}`);

    // 一時ファイルに記事を保存
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFile = path.join(tempDir, `article-${Date.now()}.md`);
    fs.writeFileSync(tempFile, articleContent, 'utf-8');

    try {
      const result = await publishCommand({
        title: title || '',
        notionPageId,
        articleFile: tempFile,
      });

      res.json({
        success: true,
        notionPageId: result.notionPageId,
        thumbnailUrl: result.thumbnailUrl,
        xPost: result.xPost,
      });
    } finally {
      // 一時ファイルを削除
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  } catch (error) {
    console.error('[API] Publishエラー:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
});

// 設定確認エンドポイント
app.get('/api/status', (req, res) => {
  const envStatus = {
    claude: !!process.env.CLAUDE_API_KEY,
    notion: !!process.env.NOTION_API_KEY && !!process.env.NOTION_DATABASE_ID,
    gemini: !!process.env.GEMINI_API_KEY,
    imgbb: !!process.env.IMGBB_API_KEY,
  };

  res.json({
    status: 'ok',
    env: envStatus,
    allConfigured: Object.values(envStatus).every(v => v),
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  TechTime Blog Automation Server                       ║
║  http://localhost:${PORT}                                 ║
╚════════════════════════════════════════════════════════╝
  `);
});
