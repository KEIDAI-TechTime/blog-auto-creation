export const thumbnailInfoPrompt = (articleTitle: string, articleContent: string) => `
以下の記事タイトルと内容に基づき、サムネイル画像生成用の情報を作成してください。

## 記事タイトル
${articleTitle}

## 記事内容（冒頭部分）
${articleContent.slice(0, 1000)}

## 出力形式（JSON）
{
  "mainTitle": "メインタイトル（2行に分けて、各行10文字以内）\\n例: '○○の真実\\n知られざる裏側'",
  "subTitle": "サブタイトル（20文字以内、記事の要点を一言で）",
  "backgroundTheme": "背景テーマ（英語で、例: 'a modern office workspace with computers', 'digital network connections', 'business meeting scene'）"
}

JSONのみを出力してください。
`;

export const thumbnailPrompt = (
  mainTitle: string,
  subTitle: string,
  backgroundTheme: string
) => {
  const titleLines = mainTitle.split('\n');
  const line1 = titleLines[0] || '';
  const line2 = titleLines[1] || '';

  return `A wide horizontal image (1280x720 aspect ratio) for a blog thumbnail. The background shows ${backgroundTheme}, with a strong blue color grading, heavy blur/depth of field effect, and dim atmospheric lighting with scattered light source highlights. In the center of the image, place a dark charcoal semi-transparent rectangular box, tilted at approximately 5 degrees to the left, with a thin green border line around it. Inside the box, display white bold Japanese text in two lines at the top reading "${line1}" on the first line and "${line2}" on the second line. At the bottom of the box, display smaller white thin Japanese text reading "${subTitle}". Professional, modern blog thumbnail style.`;
};
