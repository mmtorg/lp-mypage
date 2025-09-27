// app/route.ts
export const runtime = "edge"; // Workersでの実行を明示（任意）

export function GET(req: Request) {
  // 既存のクエリは持ち回さず、/mypage へ素直にリダイレクト
  const location = new URL("/mypage", req.url).toString();
  return new Response(null, { status: 307, headers: { Location: location } });
}

export function HEAD(req: Request) {
  const location = new URL("/mypage", req.url).toString();
  return new Response(null, { status: 307, headers: { Location: location } });
}
