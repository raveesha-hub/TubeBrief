// =====================================================
// 1. IMPORT MODULES
// =====================================================

const http = require('http');
const fs = require('fs');
const path = require('path');


// =====================================================
// 2. LOAD .ENV FILE
// =====================================================

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split(/\r?\n/)
    .forEach(line => {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);

      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
          .replace(/^["']|["']$/g, '')
          .trim();
      }
    });
} catch (error) {
  console.log('.env file could not be loaded.');
}


// =====================================================
// 3. SETTINGS
// =====================================================

const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};


// =====================================================
// 4. YOUTUBE URL VALIDATION
// =====================================================

const YT = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{11}/i;


// =====================================================
// 5. GET YOUTUBE VIDEO TRANSCRIPT
// =====================================================

async function getYouTubeTranscript(url) {

  const { fetchTranscript } = await import('youtube-transcript');

  const normalizedUrl = /^https?:\/\//i.test(url)
    ? url
    : 'https://' + url;

  const parsedUrl = new URL(normalizedUrl);

  let videoId;

  if (parsedUrl.hostname.includes('youtu.be')) {

    videoId = parsedUrl.pathname.split('/')[1];

  } else {

    videoId =
      parsedUrl.searchParams.get('v') ||
      parsedUrl.pathname.match(/(?:shorts|live)\/([\w-]{11})/)?.[1];

  }

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    throw new Error('Invalid YouTube video URL.');
  }

  const captions = await fetchTranscript(videoId);

  const transcript = captions
    .map(item => item.text)
    .join(' ');

  if (!transcript.trim()) {
    throw new Error('Transcript not available for this video.');
  }

  return transcript;
}


// =====================================================
// 6. BUILD AI PROMPT
// =====================================================

function buildPrompt({ question, language }) {

  const lang = language && language !== 'auto'
    ? language
    : 'the same language as the user question (default English)';

  if (question) {

    return `Answer the user's question about this video.

Use bullet points where helpful.

Reply in ${lang}.

Question: ${question}`;

  }

  return `Summarize this video. Reply in ${lang}.

Use exactly this markdown structure:

## Short Summary
(3-4 sentences)

## Key Points
- ...

## Important Notes
- ...

## Bullet Point Summary
- ... (point by point, in order of the video)

Be accurate. Do not invent content that is not in the video.`;
}


// =====================================================
// 7. CALL GEMINI API WITH RETRY SYSTEM
// =====================================================

async function callGemini({ question, language, transcript }) {

  const parts = [];

  parts.push({
    text: 'Video transcript:\n' + transcript.slice(0, 200000)
  });

  parts.push({
    text: buildPrompt({ question, language })
  });

  let r;
  let data;

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {

    try {

      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': KEY
          },

          body: JSON.stringify({
            contents: [{ parts }]
          })
        }
      );

    } catch (networkError) {

      if (attempt === maxAttempts - 1) {
        throw new Error(
          'Could not connect to Gemini API: ' + networkError.message
        );
      }

      const delay = 2000 * Math.pow(2, attempt);

      console.log(
        `Network error. Retrying in ${delay / 1000} seconds...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));

      continue;
    }

    try {
      data = await r.json();
    } catch (error) {
      throw new Error('Invalid response received from Gemini API.');
    }

    // SUCCESS
    if (r.ok) {
      break;
    }

    // RETRYABLE ERRORS
    const retryableErrors = [429, 500, 502, 503, 504];

    if (!retryableErrors.includes(r.status)) {

      throw new Error(
        `Gemini API Error (${r.status}): ${
          data?.error?.message || 'Unknown API error'
        }`
      );

    }

    // LAST ATTEMPT
    if (attempt === maxAttempts - 1) {

      throw new Error(
        `Gemini API Error (${r.status}): ${
          data?.error?.message || 'Please try again later.'
        }`
      );

    }

    // WAIT BEFORE RETRY
    const delay = 2000 * Math.pow(2, attempt);

    console.log(
      `Gemini error ${r.status}. Retry ${attempt + 1}/${maxAttempts - 1} after ${delay / 1000} seconds.`
    );

    await new Promise(resolve => setTimeout(resolve, delay));

  }

  // GET GEMINI RESPONSE

  const result = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('');

  if (!result) {

    throw new Error(
      data?.promptFeedback?.blockReason ||
      'AI returned no content.'
    );

  }

  return result;
}


// =====================================================
// 8. SEND JSON RESPONSE
// =====================================================

function send(res, code, obj) {

  res.writeHead(code, {
    'Content-Type': 'application/json'
  });

  res.end(JSON.stringify(obj));

}


// =====================================================
// 9. MAIN SERVER
// =====================================================

const server = http.createServer(async (req, res) => {


  // ===================================================
  // YOUTUBE SUMMARIZER API
  // ===================================================

  if (req.method === 'POST' && req.url === '/api/summarize') {

    let body = '';

    req.on('data', chunk => {

      body += chunk;

      if (body.length > 1e6) {
        req.destroy();
      }

    });

    req.on('end', async () => {

      try {

        // CHECK API KEY

        if (!KEY) {

          return send(res, 500, {
            error: 'GEMINI_API_KEY is not set in .env'
          });

        }


        // GET REQUEST DATA

        const { url, question, language } =
          JSON.parse(body || '{}');


        // CHECK YOUTUBE URL

        if (!YT.test(url || '')) {

          return send(res, 400, {
            error: 'Please enter a valid YouTube URL.'
          });

        }


        // STEP 1 - GET TRANSCRIPT

        console.log('Getting YouTube transcript...');

        const transcript = await getYouTubeTranscript(url);

        console.log('Transcript received successfully.');


        // STEP 2 - CALL GEMINI

        console.log('Sending transcript to Gemini...');

        const result = await callGemini({

          question: (question || '').trim(),

          language,

          transcript

        });


        // STEP 3 - SEND RESULT

        console.log('Summary generated successfully.');

        send(res, 200, {
          result
        });

      } catch (error) {

        console.error('Summarize Error:', error);

        send(res, 500, {
          error: error.message || 'Something went wrong.'
        });

      }

    });

    return;

  }


  // ===================================================
  // 10. SERVE WEBSITE FILES
  // ===================================================

  let p = decodeURIComponent(req.url.split('?')[0]);

  if (p === '/') {
    p = '/index.html';
  }

  const file = path.resolve(PUBLIC, '.' + p);

  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {

    res.writeHead(403);

    return res.end();

  }

  fs.readFile(file, (error, data) => {

    if (error) {

      res.writeHead(404);

      return res.end('Not found');

    }

    res.writeHead(200, {

      'Content-Type':
        MIME[path.extname(file)] || 'application/octet-stream'

    });

    res.end(data);

  });

});


// =====================================================
// 11. START SERVER
// =====================================================

server.listen(PORT, () => {

  console.log('===================================');
  console.log('TubeBrief Server Started');
  console.log(`Website: http://localhost:${PORT}`);
  console.log(`Gemini Model: ${MODEL}`);
  console.log('===================================');

});