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
    const { text, voice_id } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Missing narration text' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Secret key stored on server side
    const apiKey = process.env.ELEVENLABS_API_KEY || 'sk_6f8a081139816a1b900b65445b32e4aecf3a331d2635c2eb';
    const targetVoice = voice_id || '21m00Tcm4TlvDq8ikWAM';

    const elevenResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!elevenResponse.ok) {
      const errText = await elevenResponse.text();
      return new Response(errText, { 
        status: elevenResponse.status, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Pipe audio stream directly back to the client
    return new Response(elevenResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
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