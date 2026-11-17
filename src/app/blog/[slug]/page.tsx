import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPost, posts } from "@/lib/blog";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com";

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Not found" };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { title: post.title, description: post.description, type: "article", publishedTime: post.date },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Organization", name: "Nolgic" },
    publisher: { "@type": "Organization", name: "Nolgic", url: BASE },
    mainEntityOfPage: `${BASE}/blog/${post.slug}`,
  };

  return (
    <main id="content" className="max-w-xl mx-auto px-5 py-16 leading-relaxed">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="text-sm mb-6">
        <Link href="/blog" className="underline underline-offset-4">Blog</Link>
      </p>
      <h1 className="font-display font-extrabold text-3xl mb-2">{post.title}</h1>
      <p className="text-haze text-sm mb-10">Published {post.date}</p>
      {post.sections.map((s) => (
        <section key={s.heading}>
          <h2 className="font-display font-bold text-xl mb-3">{s.heading}</h2>
          {s.paras.map((t, i) => (
            <p key={i} className="text-haze mb-6">{t}</p>
          ))}
        </section>
      ))}
      <div className="mt-10 border-t pt-8">
        <p className="mb-4">Ready to pay? Start on the home page.</p>
        <Link href="/" className="font-semibold underline underline-offset-4">Pay a bill on Nolgic</Link>
      </div>
    </main>
  );
}
