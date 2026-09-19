export const config = {
  runtime: 'edge',
};

// Generates an exact 8.0-second MPEG-2 Layer 3 silent frame buffer (24kHz, 32kbps mono)
function get8SecondMp3Silence() {
  const frame = new Uint8Array(96);
  frame[0] = 0xFF;
  frame[1] = 0xF3;
  frame[2] = 0x40;
  frame[3] = 0xC4;
  // bytes 4..95 remain 0x00 for complete digital silence

  const frameCount = 334; // 334 frames * 0.024s = 8.016 seconds
  const silenceBuffer = new Uint8Array(frameCount * 96);
  for (let i = 0; i < frameCount; i++) {
    silenceBuffer.set(frame, i * 96);
  }
  return silenceBuffer;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  try {
    const { text, provider, voice_id, lang } = await req.json().catch(() => ({}));

    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Missing narration text' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // 1. Cantonese Audio Generator (Handles 8-second break tags with true MP3 silence)
    if (provider === 'cantonese') {
      const targetLang = lang || 'zh-HK';

      // Split text on the 8s break tags into distinct paragraphs
      const paragraphs = text
        .split(/<break[^>]*\/>/i)
        .map(p => p.trim())
        .filter(Boolean);

      const audioBuffers = [];
      const silenceChunk = get8SecondMp3Silence();

      for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const paragraph = paragraphs[pIdx];

        // Slices into sentence clauses under 60 chars for Google TTS
        const clauses = paragraph
          .replace(/\r\n/g, '\n')
          .split(/([，。！？；、\n]+)/)
          .filter(Boolean);

        const chunks = [];
        let current = '';
        for (const c of clauses) {
          if ((current + c).length > 55) {
            if (current.trim()) chunks.push(current.trim());
            current = c;
          } else {
            current += c;
          }
        }
        if (current.trim()) chunks.push(current.trim());

        // Synthesize each clause of this paragraph
        for (const chunk of chunks) {
          if (!chunk.replace(/[，。！？；、\s]/g, '')) continue;
          const ttsUrl = `https://translate.google.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(targetLang)}&q=${encodeURIComponent(chunk)}`;
          
          const resp = await fetch(ttsUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://translate.google.com/'
            }
          });

          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            audioBuffers.push(new Uint8Array(buf));
          }
        }

        // Insert 8 seconds of silent audio between paragraphs (except after the final paragraph)
        if (pIdx < paragraphs.length - 1) {
          audioBuffers.push(silenceChunk);
        }
      }

      if (audioBuffers.length === 0) {
        throw new Error('Failed to generate Cantonese audio chunks from TTS engine.');
      }

      // Concatenate all speech and 8s silence buffers into a single MP3 file
      const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const b of audioBuffers) {
        combined.set(b, offset);
        offset += b.byteLength;
      }

      return new Response(combined, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': 'attachment; filename="soundtrack.mp3"',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // 2. ElevenLabs English Engine (Supports native SSML break tags)
    const apiKey = process.env.ELEVENLABS_API_KEY || 'sk_6f8a081139816a1b900b65445b32e4aecf3a331d2635c2eb';
    const targetVoice = voice_id && voice_id !== 'piTKgcLEGmPE4e6mEKli' ? voice_id : '21m00Tcm4TlvDq8ikWAM';

    const elevenResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!elevenResponse.ok) {
      const errText = await elevenResponse.text();
      let parsedMessage = `HTTP ${elevenResponse.status}`;
      try {
        const json = JSON.parse(errText);
        parsedMessage = json?.detail?.message || json?.detail || json?.message || errText;
      } catch (_) {
        parsedMessage = errText;
      }

      return new Response(JSON.stringify({ error: parsedMessage }), { 
        status: elevenResponse.status, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    return new Response(elevenResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="soundtrack.mp3"',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}