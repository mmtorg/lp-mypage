// Supabase Auth の英語エラーメッセージを日本語に変換するユーティリティ
// 想定メッセージの揺れに対応するため、一部は部分一致で判定します。

export function toJapaneseAuthErrorMessage(
  err: unknown,
  fallback?: string
): string {
  const defaultMsg =
    fallback || "エラーが発生しました。時間をおいて再度お試しください。";

  const msg = (() => {
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const m = (err as any).message;
      if (typeof m === "string") return m;
    }
    return "";
  })();

  const m = (msg || "").toLowerCase();

  // 代表的な Supabase 認証エラーのメッセージ変換
  if (m.includes("invalid login credentials")) {
    return "パスワードが正しくありません。";
  }
  if (m.includes("auth session missing")) {
    return "認証セッションが見つかりません。メールを再送してください。";
  }
  if (m.includes("email not confirmed")) {
    return "メールアドレスの確認が完了していません。";
  }
  if (
    m.includes("user already registered") ||
    m.includes("user already exists")
  ) {
    return "このメールアドレスは既に登録されています。ログインしてください。";
  }
  if (m.includes("invalid email")) {
    return "メールアドレスの形式が正しくありません。";
  }
  if (
    m.includes("token has expired") ||
    m.includes("token is expired") ||
    m.includes("invalid or expired") ||
    m.includes("Email link is invalid or has expired")
  ) {
    return "リンクの有効期限が切れているか無効です。もう一度お試しください。";
  }
  if (
    m.includes("password should be at least") ||
    m.includes("password is too short")
  ) {
    // 本プロジェクトでは 8 文字以上・大小英字・数字の各 1 文字以上を推奨
    return "パスワードは8文字以上・大小英字と数字を各1文字以上含めてください。";
  }
  if (m.includes("new password should be different from the old password")) {
    return "新しいパスワードは以前のパスワードと異なる必要があります。";
  }
  if (m.includes("password sign-in is not enabled")) {
    return "このプロジェクトではパスワードでのログインは無効です。";
  }
  if (m.includes("user not found")) {
    return "ユーザーが見つかりません。メールアドレスをご確認ください。";
  }
  if (
    m.includes("email rate limit") ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  ) {
    return "短時間に複数回リクエストされました。しばらくしてからお試しください。";
  }
  if (m.includes("invalid oauth") || m.includes("oauth callback")) {
    return "外部サービスでの認証に失敗しました。時間をおいて再度お試しください。";
  }
  // 例: "For security purposes, you can only request this after 17 seconds."
  if (
    m.includes("for security purposes, you can only request this after")
  ) {
    const secMatch = msg.match(/after\s+(\d+)\s*seconds?/i);
    if (secMatch) {
      return `セキュリティのため、再リクエストは${secMatch[1]}秒後に可能です。`;
    }
    return "セキュリティのため、一定時間後に再リクエストが可能です。";
  }

  // 上記に該当しなければ元メッセージをそのまま（英語のまま）返すか、フォールバック
  return msg || defaultMsg;
}
