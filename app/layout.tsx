import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "MyPage",
  generator: "mypage-app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        {children}
        {/* Inline helper to keep Payment Link in same tab and adjust modal labels */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const STRIPE_HOST_RE = /(^https?:\/\/)?(buy|pay)\.stripe\.com/i;
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    try {
      if (typeof url === 'string' && STRIPE_HOST_RE.test(url)) {
        try { console.log('[ui] suppress new tab for Stripe Payment Link'); } catch {}
        return null; // do not open new tab; modal will guide same-tab navigation
      }
    } catch {}
    // @ts-ignore
    return originalOpen.apply(window, arguments);
  };

  const adjust = () => {
    try {
      const roots = document.querySelectorAll('[role="dialog"], .DialogContent, [data-state="open"]');
      roots.forEach((root) => {
        const link = root.querySelector('a[href*="stripe.com"]');
        if (link && STRIPE_HOST_RE.test((link as HTMLAnchorElement).href) && !(link as any).dataset._patchedLink) {
          (link as any).dataset._patchedLink = '1';
          (link as HTMLAnchorElement).removeAttribute('target');
          (link as HTMLAnchorElement).removeAttribute('rel');
          (link as HTMLAnchorElement).textContent = '決済画面を開く';
          const title = root.querySelector('h2, h3, [data-dialog-title]');
          if (title) (title as HTMLElement).textContent = '決済画面を開きます';
          const desc = root.querySelector('p, [data-dialog-description]');
          if (desc) (desc as HTMLElement).textContent = 'サブスクリプション購入画面で購入を確定してください';
        }
      });
    } catch {}
  };

  const mo = new MutationObserver(adjust);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', adjust);
  window.addEventListener('load', adjust);
})();`,
          }}
        />
        <Analytics />
        <Toaster />
      </body>
    </html>
  );
}
