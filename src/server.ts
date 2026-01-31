import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { draftCommand } from './commands/draft';
import { publishCommand } from './commands/publish';
import { autoCommand } from './commands/auto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// APIエンドポイント: 下書き生成
app.post('/api/draft', async (req, res) => {
  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'タイトルは必須です' });
    }

    console.log(`[API] Draft開始: ${title}`);

    const result = await draftCommand({ title });

    res.json({
      success: true,
      articleContent: result.articleContent,
      references: result.references,
      outputPath: result.outputPath,
    });
  } catch (error) {
    console.error('[API] Draftエラー:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
});

// APIエンドポイント: 公開
app.post('/api/publish', async (req, res) => {
  try {
    const { title, notionUrl, draftFile } = req.body;

    if (!title || !notionUrl || !draftFile) {
      return res.status(400).json({
        error: 'title, notionUrl, draftFile は必須です'
      });
    }

    console.log(`[API] Publish開始: ${title}`);

    const result = await publishCommand({ title, notionUrl, draftFile });

    res.json({
      success: true,
      notionUrl: result.notionUrl,
      thumbnailUrl: result.thumbnailUrl,
      xPost: result.xPost,
    });
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
    notion: !!process.env.NOTION_API_KEY,
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
