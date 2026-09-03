// Instagramの最新投稿の画像を取得して instagram-photo.jpg として保存し、
// 「Instagramを見る」ボタンの日付・リンク先（content.js）も更新する。
// GitHub Actions から定期実行される想定（IG_ACCESS_TOKEN が必要）。
import { readFile, writeFile } from "node:fs/promises";

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

async function findLatestImageUrl(item) {
  if (item.media_type === "IMAGE") {
    return item.media_url;
  }
  if (item.media_type === "VIDEO") {
    return item.thumbnail_url || null;
  }
  if (item.media_type === "CAROUSEL_ALBUM") {
    const childrenUrl = `https://graph.instagram.com/${item.id}/children?fields=id,media_type,media_url,thumbnail_url&access_token=${token}`;
    const children = await getJson(childrenUrl);
    const first = (children.data || [])[0];
    if (!first) return null;
    if (first.media_type === "VIDEO") return first.thumbnail_url || null;
    return first.media_url;
  }
  return null;
}

async function findLatestPost() {
  const mediaUrl = `https://graph.instagram.com/me/media?fields=id,media_type,media_url,thumbnail_url,timestamp,permalink&limit=5&access_token=${token}`;
  const media = await getJson(mediaUrl);
  const items = media.data || [];
  if (items.length === 0) throw new Error("投稿が見つかりませんでした。");

  for (const item of items) {
    const imageUrl = await findLatestImageUrl(item);
    if (imageUrl) return { item, imageUrl };
  }
  throw new Error("表示できる画像付きの投稿が見つかりませんでした。");
}

async function updateContentJs(item) {
  const contentPath = new URL("../content.js", import.meta.url);
  let text = await readFile(contentPath, "utf8");

  const dateStr = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric"
  }).format(new Date(item.timestamp));

  text = text.replace(
    /"instagramUrl":\s*"[^"]*"/,
    `"instagramUrl": "${item.permalink}"`
  );
  text = text.replace(
    /"instagramLabel":\s*"[^"]*"/,
    `"instagramLabel": "📷 ${dateStr}Instagramを見る"`
  );

  await writeFile(contentPath, text);
  console.log("content.js のInstagramリンク・日付を更新しました。");
}

async function main() {
  const { item, imageUrl } = await findLatestPost();

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`画像のダウンロードに失敗しました（${imageRes.status}）`);
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  await writeFile(new URL("../instagram-photo.jpg", import.meta.url), buffer);
  console.log("instagram-photo.jpg を更新しました。");

  await updateContentJs(item);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
