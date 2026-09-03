// Instagramの最新投稿の画像を取得して instagram-photo.jpg として保存する。
// GitHub Actions から定期実行される想定（IG_ACCESS_TOKEN が必要）。
import { writeFile } from "node:fs/promises";

const token = process.env.IG_ACCESS_TOKEN;
if (!token) {
  console.error("IG_ACCESS_TOKEN が設定されていません。");
  process.exit(1);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Instagram APIエラー（${res.status}）: ${await res.text()}`);
  }
  return res.json();
}

async function findLatestImageUrl() {
  const mediaUrl = `https://graph.instagram.com/me/media?fields=id,media_type,media_url,thumbnail_url,timestamp&limit=5&access_token=${token}`;
  const media = await getJson(mediaUrl);
  const items = media.data || [];
  if (items.length === 0) throw new Error("投稿が見つかりませんでした。");

  for (const item of items) {
    if (item.media_type === "IMAGE") {
      return item.media_url;
    }
    if (item.media_type === "VIDEO") {
      if (item.thumbnail_url) return item.thumbnail_url;
      continue;
    }
    if (item.media_type === "CAROUSEL_ALBUM") {
      const childrenUrl = `https://graph.instagram.com/${item.id}/children?fields=id,media_type,media_url,thumbnail_url&access_token=${token}`;
      const children = await getJson(childrenUrl);
      const first = (children.data || [])[0];
      if (!first) continue;
      if (first.media_type === "VIDEO") {
        if (first.thumbnail_url) return first.thumbnail_url;
        continue;
      }
      return first.media_url;
    }
  }
  throw new Error("表示できる画像付きの投稿が見つかりませんでした。");
}

async function main() {
  const imageUrl = await findLatestImageUrl();
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`画像のダウンロードに失敗しました（${imageRes.status}）`);
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  await writeFile(new URL("../instagram-photo.jpg", import.meta.url), buffer);
  console.log("instagram-photo.jpg を更新しました。");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
