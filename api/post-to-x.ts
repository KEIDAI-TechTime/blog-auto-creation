import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

// OAuth 1.0a signature generation
function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

// Generate OAuth header
function generateOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
  additionalParams: Record<string, string> = {}
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
    ...additionalParams
  };

  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    consumerSecret,
    accessTokenSecret
  );

  oauthParams.oauth_signature = signature;

  const headerParams = Object.keys(oauthParams)
    .filter(key => key.startsWith('oauth_'))
    .sort()
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${headerParams}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: '投稿文は必須です' });
    }

    // 環境変数チェック
    const consumerKey = process.env.X_API_KEY;
    const consumerSecret = process.env.X_API_SECRET;
    const accessToken = process.env.X_ACCESS_TOKEN;
    const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      return res.status(500).json({ error: 'X API credentials が設定されていません' });
    }

    // X API v2 tweet endpoint
    const url = 'https://api.twitter.com/2/tweets';

    const authHeader = generateOAuthHeader(
      'POST',
      url,
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text })
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('X API Error:', responseData);
      return res.status(response.status).json({
        error: responseData.detail || responseData.title || 'X APIエラー',
        details: responseData
      });
    }

    res.json({
      success: true,
      tweetId: responseData.data?.id,
      text: responseData.data?.text
    });
  } catch (error) {
    console.error('Post to X error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '不明なエラー'
    });
  }
}
