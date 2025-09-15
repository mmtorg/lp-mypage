import { SimpleButton } from "@/components/simple-button"
import {
  SimpleCard,
  SimpleCardContent,
  SimpleCardDescription,
  SimpleCardHeader,
  SimpleCardTitle,
} from "@/components/simple-card"
import { SimpleBadge } from "@/components/simple-badge"
import Link from "next/link"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 w-full border-b bg-white shadow-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🌐</span>
            <span className="text-xl font-bold text-gray-900">Myanmar News Alert</span>
          </div>
          <nav className="hidden md:flex items-center space-x-6">
            <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors">
              特徴
            </a>
            <a href="#sample" className="text-gray-600 hover:text-gray-900 transition-colors">
              サンプル
            </a>
            <a href="#plans" className="text-gray-600 hover:text-gray-900 transition-colors">
              プラン
            </a>
            <Link href="/mypage">
              <SimpleButton variant="outline" size="sm">
                マイページ
              </SimpleButton>
            </Link>
          </nav>
        </div>
      </header>

      <section className="py-20 bg-white">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">ミャンマー関連ニュースを毎日お届け</h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Myanmar News
            Alertは、日本語で読める最新のミャンマー関連ニュースを毎日メールで配信します。LiteプランとBusinessプランの2種類から、ご利用目的に合わせてプランをお選びいただけます。ビジネス利用にも最適です。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <SimpleButton size="lg">
              <a href="#plans">プランを比較する</a>
            </SimpleButton>
            <SimpleButton size="lg" variant="outline">
              <a href="#contact">無料トライアルを開始</a>
            </SimpleButton>
          </div>
        </div>
      </section>

      <section id="sample" className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4 text-gray-900">配信メールサンプル</h2>
            <p className="text-gray-600">実際にお届けするニュース配信メールの例をご覧ください</p>
          </div>

          <div className="max-w-2xl mx-auto">
            <SimpleCard className="border-[#0b6465] border-2 shadow-lg">
              <SimpleCardHeader className="bg-white border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <SimpleCardTitle className="text-lg text-gray-900">
                      Myanmar News Alert - 2024年1月15日
                    </SimpleCardTitle>
                    <SimpleCardDescription>daily-news@myanmar-news-alert.com</SimpleCardDescription>
                  </div>
                  <span className="text-xl">📧</span>
                </div>
              </SimpleCardHeader>
              <SimpleCardContent className="p-6">
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-gray-900 border-b pb-2">
                    ------- ヘッドライン (17本) -------
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">戦争の犠牲者たち：アルコールに依存するロシア兵</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">
                        ミン・アウン・フラインへの誓約によりドクター・エーマウンが恩赦を受け、選挙への出馬権を獲得
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">
                        NUG首相、軍事政権の選挙に意図的に参加・組織・情報拡散する者を記録し措置を講じるよう指示
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">
                        漁師を装いAA隊員2名を殺害し武器を強奪、AAは密漁者に対し厳重な対処を警告
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">
                        ミャンマー代表のウー・チョー・モー・トゥン大使続投を決定する国連信任状委員会が9ヶ国で構成され、第80回国連総会が開始
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">シュウェエーチー・ストライキ隊が国軍開催の偽選挙に抗議</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">
                        チャウッダッダー郡区、ナッサンクイン検問所の新兵1名が銃1丁を持って投降
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[#0b6465] mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-gray-600">
                        タイのチョンブリー県工場で不当解雇されたミャンマー人労働者37人、NUG労働省とMHACの支援で賃金22万バーツ超を回収
                      </span>
                    </div>
                  </div>
                </div>
              </SimpleCardContent>
            </SimpleCard>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6 text-gray-900">毎日届く最新のミャンマー関連ニュース</h2>
              <p className="text-gray-600 mb-6 leading-relaxed">
                Myanmar News
                Alertは、ミャンマーに関する最新ニュースを毎日メールでお届けします。海外記事を日本語でまとめて配信。時事問題やビジネス動向など、重要な情報をいち早くキャッチできます。現地情勢の変化が激しいミャンマーにおいて、タイムリーで確かな情報を手軽に入手したい方に最適です。
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[#0b6465]">✓</span>
                  <span>毎日の最新ニュース配信</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#0b6465]">✓</span>
                  <span>日本語での要約・翻訳</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#0b6465]">✓</span>
                  <span>ビジネス・時事問題を網羅</span>
                </div>
              </div>
            </div>
            <div className="bg-white p-8 rounded-lg border-2 border-[#0b6465]">
              <span className="text-4xl text-[#0b6465] mb-4 block">📧</span>
              <h3 className="text-xl font-semibold mb-4">信頼できる情報源</h3>
              <p className="text-gray-600">
                Myanmar News Alertは、Reuters、BBC News、Associated Press、The
                Irrawaddyなど、信頼性の高い国際メディアから最新情報を収集し、日本語で要約してお届けします。現地の独立メディアからの情報も含め、多角的な視点でミャンマー情勢をお伝えします。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Plans Section */}
      <section id="plans" className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4 text-gray-900">料金プラン</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">ご利用目的に合わせて最適なプランをお選びください</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Lite Plan */}
            <SimpleCard className="relative border-2 border-[#0b6465] shadow-lg">
              <SimpleCardHeader>
                <SimpleCardTitle className="text-2xl text-gray-900">Liteプラン</SimpleCardTitle>
                <SimpleCardDescription>
                  個人利用やミャンマー関連の最新ニュースを手軽に把握したい方向けのプランです。コストを抑えつつ、見出しや要約を毎日メールで受け取れます。追加アドレスも低価格で利用可能です。
                </SimpleCardDescription>
                <div className="text-3xl font-bold text-[#0b6465] mt-4">
                  4,980円<span className="text-base font-normal text-gray-600">/月（税込）</span>
                </div>
              </SimpleCardHeader>
              <SimpleCardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>毎日最新ニュース配信</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>メール配信先1つ</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>見出し・要約付きのメール配信</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>追加配信先アドレス毎：3,480円</span>
                  </li>
                </ul>
                <SimpleButton className="w-full">
                  <a href="#contact">Liteプランに申し込む</a>
                </SimpleButton>
              </SimpleCardContent>
            </SimpleCard>

            {/* Business Plan */}
            <SimpleCard className="relative border-2 border-[#0b6465] shadow-lg">
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                <SimpleBadge className="bg-[#0b6465] text-white">おすすめ</SimpleBadge>
              </div>
              <SimpleCardHeader>
                <SimpleCardTitle className="text-2xl text-gray-900">Businessプラン</SimpleCardTitle>
                <SimpleCardDescription>
                  企業やチームでの情報共有に最適なビジネス向けプランです。配信先を2つまで設定可能で、記事全文の日本語訳PDFや出典リンクも提供します。追加アドレスは5,980円で拡張可能です。
                </SimpleCardDescription>
                <div className="text-3xl font-bold text-[#0b6465] mt-4">
                  17,980円<span className="text-base font-normal text-gray-600">/月（税込）</span>
                </div>
              </SimpleCardHeader>
              <SimpleCardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>毎日最新ニュース配信</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>メール配信先2つ</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>見出し・要約付きのメール配信</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>出典リンクURL付き</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-[#0b6465]">✓</span>
                    <span>全文日本語訳PDF添付</span>
                  </li>
                </ul>
                <SimpleButton className="w-full">
                  <a href="#contact">Businessプランに申し込む</a>
                </SimpleButton>
              </SimpleCardContent>
            </SimpleCard>
          </div>

          {/* Annual Discount */}
          <div className="mt-12 text-center">
            <SimpleCard className="max-w-2xl mx-auto bg-white border-2 border-[#0b6465] shadow-lg">
              <SimpleCardHeader>
                <SimpleCardTitle className="text-xl text-gray-900">年間契約割引</SimpleCardTitle>
                <SimpleCardDescription>
                  さらにお得にご利用されたい方は、年間契約で各プランの月額料金が10%割引となります。長期でご利用予定のお客様におすすめです。
                </SimpleCardDescription>
              </SimpleCardHeader>
              <SimpleCardContent>
                <div className="text-2xl font-bold text-[#0b6465] mb-4">各プラン月額より10%OFF/年払い</div>
                <ul className="space-y-2 text-sm text-gray-600 mb-6">
                  <li>• Liteプラン・Businessプランどちらも対象</li>
                  <li>• 毎月のコストを抑えられる</li>
                  <li>• 契約期間中の料金固定</li>
                  <li>• 請求手続きの簡略化</li>
                  <li>• 長期利用での安心</li>
                </ul>
                <SimpleButton variant="outline">
                  <a href="#contact">年間契約で申し込む</a>
                </SimpleButton>
              </SimpleCardContent>
            </SimpleCard>
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <SimpleCard className="border-2 border-[#0b6465] shadow-lg overflow-hidden">
              <div className="p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">柔軟な配信先追加オプション</h2>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  両プランともに、配信先メールアドレスの追加が可能です。追加費用のみで、より多くのメンバーが最新情報を受け取ることができます。組織の規模や用途に合わせて柔軟にご利用ください。
                </p>
                <SimpleButton>
                  <Link href="/mypage">マイページを開く</Link>
                </SimpleButton>
              </div>
            </SimpleCard>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-gray-100 border-t">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <span className="text-2xl text-[#0b6465]">🌐</span>
                <span className="text-xl font-bold text-gray-900">Myanmar News Alert</span>
              </div>
              <p className="text-gray-600">ミャンマー関連ニュースを毎日お届けする信頼できる情報源です。</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-4">サービス</h3>
              <ul className="space-y-2 text-gray-600">
                <li>
                  <a href="#features" className="hover:text-[#0b6465] transition-colors">
                    特徴
                  </a>
                </li>
                <li>
                  <a href="#sample" className="hover:text-[#0b6465] transition-colors">
                    サンプル
                  </a>
                </li>
                <li>
                  <a href="#plans" className="hover:text-[#0b6465] transition-colors">
                    料金プラン
                  </a>
                </li>
                <li>
                  <Link href="/mypage" className="hover:text-[#0b6465] transition-colors">
                    マイページ
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-4">サポート</h3>
              <ul className="space-y-2 text-gray-600">
                <li>
                  <a href="#contact" className="hover:text-[#0b6465] transition-colors">
                    お問い合わせ
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-[#0b6465] transition-colors">
                    よくある質問
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-[#0b6465] transition-colors">
                    利用規約
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-300 mt-8 pt-8 text-center text-gray-500">
            <p>&copy; 2024 Myanmar News Alert. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
