// app/route.ts
export function GET(req: Request) {
  const location = new URL("/mypage", req.url).toString();
  return new Response(null, { status: 307, headers: { Location: location } });
}

export function HEAD(req: Request) {
  const location = new URL("/mypage", req.url).toString();
  return new Response(null, { status: 307, headers: { Location: location } });
}
