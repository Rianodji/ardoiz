import { youtubeEmbedUrl } from "@ardoiz/content-schema";
import { useState } from "react";
import { Icon } from "../ui";
import { Play } from "../ui/icons";

/**
 * Vidéo YouTube (R13, M12) : avant le clic, une simple vignette locale — aucune requête vers Google.
 * Après le clic seulement, le lecteur est chargé depuis youtube-nocookie.com, sans suggestions (rel=0).
 */
export function YouTubeEmbed({ videoId }: { readonly videoId: string }) {
  const [playing, setPlaying] = useState(false);
  const src = youtubeEmbedUrl(videoId);
  if (src === null) return null;
  if (!playing) {
    return (
      <button
        type="button"
        className="video-placeholder"
        onClick={() => {
          setPlaying(true);
        }}
      >
        <span aria-hidden="true" className="video-play">
          <Icon icon={Play} />
        </span>
        <span>
          <strong className="video-title">Voir la vidéo</strong>
          <span className="hint">La vidéo se charge depuis YouTube seulement quand tu cliques.</span>
        </span>
      </button>
    );
  }
  return (
    <div className="video-frame">
      <iframe
        src={src}
        title="Vidéo du cours"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        loading="lazy"
      />
    </div>
  );
}
