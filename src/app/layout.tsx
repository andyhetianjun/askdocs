import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "askdocs",
  description: "Ask questions about a small set of Python standard library docs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-3xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">askdocs</Link>
            <Link href="/questionnaire" className="text-stone-600 hover:text-stone-900">Questionnaire</Link>
            <Link href="/traces" className="text-stone-600 hover:text-stone-900">Traces</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-stone-500">
          Docs from the Python 3.12 standard library documentation, PSF license. Copyright Python Software Foundation.
        </footer>
      </body>
    </html>
  );
}
