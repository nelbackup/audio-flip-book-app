export const config = {
  runtime: 'edge',
};

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

    // 1. Cantonese Cloud Engine (Splits & merges audio chunks into a valid MP3)
    if (provider === 'cantonese') {
      const targetLang = lang || 'zh-HK';

      // Split text into natural sentence chunks under 70 characters
      const sentences = text
        .replace(/\r\n/g, '\n')
        .split(/([，。！？；、\n]+)/)
        .filter(Boolean);

      const chunks = [];
      let current = '';

      for (const s of sentences) {
        if ((current + s).length > 60) {
          if (current.trim()) chunks.push(current.trim());
          current = s;
        } else {
          current += s;
        }
      }
      if (current.trim()) chunks.push(current.trim());

      const audioBuffers = [];

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
          audioBuffers.push(buf);
        }
      }

      if (audioBuffers.length === 0) {
        throw new Error('Failed to generate Cantonese audio chunks from TTS engine.');
      }

      // Concatenate all MP3 binary chunks into a single audio file
      const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const b of audioBuffers) {
        combined.set(new Uint8Array(b), offset);
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

    // 2. ElevenLabs English Engine
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