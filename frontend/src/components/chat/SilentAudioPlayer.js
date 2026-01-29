import { useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { API_BASE } from '../../config';

/**
 * SilentAudioPlayer - Plays audio without any visible UI
 * Used for [Audio:tag:nomsg] variables
 */
function SilentAudioPlayer({ tag }) {
  const { api } = useApp();
  const audioRef = useRef(null);
  const hasPlayed = useRef(false);

  useEffect(() => {
    if (hasPlayed.current) return;

    const playAudio = async () => {
      try {
        const data = await api.lookupMediaByTag('audio', tag);
        if (data && data.fileUrl && audioRef.current) {
          audioRef.current.src = `${API_BASE}${data.fileUrl}`;
          audioRef.current.play().catch(e =>
            console.log('[SilentAudio] Autoplay blocked:', e)
          );
          hasPlayed.current = true;
          console.log('[SilentAudio] Playing:', tag);
        }
      } catch (err) {
        console.error(`[SilentAudio] Failed to load audio "${tag}":`, err);
      }
    };

    playAudio();
  }, [api, tag]);

  // Hidden audio element
  return <audio ref={audioRef} style={{ display: 'none' }} />;
}

export default SilentAudioPlayer;
