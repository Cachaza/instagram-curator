"use client";

import Image from "next/image";
import { useRef, useState, type ReactNode } from "react";

type PublicationMediaProps = {
  imageUrl: string;
  videoUrl: string;
  hasImage: boolean;
  hasVideo: boolean;
  preferVideo: boolean;
  sourceUrl: string;
  unavailable: string;
  loadFailed: string;
  retryLabel: string;
  openSource: string;
  fallback: ReactNode;
};

function withFreshCacheKey(url: string, attempt: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}retry=${encodeURIComponent(attempt)}`;
}

export function PublicationMedia({
  imageUrl,
  videoUrl,
  hasImage,
  hasVideo,
  preferVideo,
  sourceUrl,
  unavailable,
  loadFailed,
  retryLabel,
  openSource,
  fallback,
}: PublicationMediaProps) {
  const [failed, setFailed] = useState(!hasImage && !hasVideo);
  const [recoveryVisible, setRecoveryVisible] = useState(!hasImage && !hasVideo);
  const [imageSrc, setImageSrc] = useState(imageUrl);
  const [videoSrc, setVideoSrc] = useState(videoUrl);
  const [posterSrc, setPosterSrc] = useState(imageUrl);
  const attempts = useRef(0);

  function mediaFailed() {
    setFailed(true);
    setRecoveryVisible(true);
  }

  function retry() {
    // An attempt counter also works on self-hosted HTTP origins, where the
    // secure-context-only crypto.randomUUID API is unavailable.
    const attempt = `${Date.now()}-${++attempts.current}`;
    setImageSrc(withFreshCacheKey(imageUrl, attempt));
    setVideoSrc(withFreshCacheKey(videoUrl, attempt));
    setPosterSrc(withFreshCacheKey(imageUrl, attempt));
    setFailed(false);
  }

  return (
    <>
      {failed ? (
        <div className="detail-media-fallback">
          {fallback}
        </div>
      ) : (hasVideo || (!hasImage && preferVideo)) ? (
        <video controls preload="metadata" poster={hasImage ? posterSrc : undefined} src={videoSrc} onError={mediaFailed} />
      ) : (
        <Image src={imageSrc} width={900} height={1200} unoptimized alt="" onError={mediaFailed} />
      )}
      <p className="media-unavailable" role="status">{failed ? (hasImage || hasVideo ? loadFailed : unavailable) : ""}</p>
      {recoveryVisible && (
        <div className="media-recovery">
          <button type="button" onClick={retry}>{retryLabel}</button>
          <a href={sourceUrl} target="_blank" rel="noreferrer">{openSource}</a>
        </div>
      )}
    </>
  );
}
