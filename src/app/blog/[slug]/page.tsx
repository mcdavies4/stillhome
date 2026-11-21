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
  const image = `/blog/${post.slug}.webp`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      images: [{ url: image, width: 1200, height: 630, alt: post.title }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [image] },
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
    image: `${BASE}/blog/${post.slug}.webp`,
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Nolgic", item: BASE },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${BASE}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: `${BASE}/blog/${post.slug}` },
    ],
  };

  return (
    <main id="content" className="max-w-xl mx-auto px-5 py-16 leading-relaxed">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <p className="text-sm mb-6">
        <Link href="/blog" className="underline underline-offset-4">Blog</Link>
      </p>
      <h1 className="font-display font-extrabold text-3xl mb-2">{post.title}</h1>
      <p className="text-haze text-sm mb-6">Published {post.date}</p>
      <img
        src={`/blog/${post.slug}.webp`}
        alt={`${post.title}: Nolgic`}
        width={1200}
        height={630}
        loading="eager"
        className="w-full h-auto rounded-lg mb-10"
      />
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
