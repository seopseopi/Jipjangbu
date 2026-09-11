import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-korean",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "업무비서 | 부동산 업무관리",
  description: "업무일지, 매물, 고객, 일정을 한곳에서 관리합니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={notoSansKr.variable}>{children}</body></html>;
}
