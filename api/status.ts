import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const envStatus = {
    claude: !!process.env.CLAUDE_API_KEY,
    notion: !!process.env.NOTION_API_KEY && !!process.env.NOTION_DATABASE_ID,
    gemini: !!process.env.GEMINI_API_KEY,
    imgbb: !!process.env.IMGBB_API_KEY,
    x: !!process.env.X_API_KEY && !!process.env.X_API_SECRET &&
       !!process.env.X_ACCESS_TOKEN && !!process.env.X_ACCESS_TOKEN_SECRET,
  };

  res.json({
    status: 'ok',
    env: envStatus,
    allConfigured: Object.values(envStatus).every(v => v),
  });
}
