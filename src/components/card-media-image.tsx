"use client";

import Image from "next/image";
import { useState } from "react";

export function CardMediaImage({ src, unavailable }: { src: string; unavailable: string }) {
  const [failed, setFailed] = useState<string | null>(null);

  if (failed === src) return <span className="card-media-fallback">{unavailable}</span>;

  return <Image src={src} width={700} height={440} unoptimized alt="" onError={() => setFailed(src)} />;
}
