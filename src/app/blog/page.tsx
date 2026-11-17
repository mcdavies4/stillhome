import Link from "next/link";
import type { Metadata } from "next";
import { posts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog: how to pay bills in Nigeria",
  description: "Guides to paying DStv, electricity, airtime and data in naira online, and paying bills for family from abroad.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  return (
    <main id="content" className="max-w-xl mx-auto px-5 py-16 leading-relaxed">
      <h1 className="font-display font-extrabold text-3xl mb-2">Blog</h1>
      <p className="text-haze mb-10">Short guides to paying bills in naira with Nolgic.</p>
      <ul className="space-y-8">
        {posts.map((p) => (
          <li key={p.slug}>
            <h2 className="font-display font-bold text-xl mb-2">
              <Link href={`/blog/${p.slug}`} className="underline underline-offset-4">{p.title}</Link>
            </h2>
            <p className="text-haze">{p.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
