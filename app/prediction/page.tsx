import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Prediction",
  description: "Prediction markets are coming to Angler Terminal.",
  alternates: { canonical: "/prediction" },
};

/** Placeholder until prediction markets ship: the brand banner (angler-landing's og-banner) and two lines. */
export default function PredictionPage() {
  return (
    <section className="surface-panel relative h-full min-h-[420px] overflow-hidden rounded-2xl border border-app-card/80 bg-[#060b12]">
      <Image src="/brand/angler-banner.jpg" alt="" fill priority sizes="(min-width: 1024px) 80vw, 100vw" className="object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-[#03070c]/80 to-transparent px-8 pb-8 pt-24 sm:px-10 sm:pb-10">
        <h1 className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-white sm:text-[56px]">Prediction</h1>
        <p className="mt-3 text-[15px] text-white/65">Coming soon</p>
      </div>
    </section>
  );
}
