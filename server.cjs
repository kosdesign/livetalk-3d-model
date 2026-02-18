const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static files from the current directory
app.use(express.static(__dirname));

// JWT endpoint - returns a mock JWT token
app.get('/app/jwt/get', (req, res) => {
  // Return a mock JWT token for development
  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock';
  res.json({ token: mockToken });
});

// API Keys endpoint - returns keys from environment variables
app.get('/api/keys', (req, res) => {
  res.json({
    gemini: process.env.GEMINI_API_KEY || '',
    microsoftTTS: process.env.MICROSOFT_TTS_KEY || '',
    googleTTS: process.env.GOOGLE_TTS_KEY || '',
    azureTTS: process.env.AZURE_TTS_KEY || '',
    azureRegion: process.env.AZURE_TTS_REGION || 'southeastasia'
  });
});

// OpenAI chat completions proxy
app.post('/openai/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model, stream, temperature, max_tokens } = req.body;
    
    // This is a proxy - in production you'd forward to actual OpenAI API
    // For now, return a mock response
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Send a simple streaming response
      const mockResponse = 'This is a mock response from the OpenAI proxy.';
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: { content: mockResponse },
          index: 0
        }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        choices: [{
          message: { content: 'This is a mock response from the OpenAI proxy.' },
          index: 0
        }]
      });
    }
  } catch (error) {
    console.error('OpenAI proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Gemini API proxy
app.all(/^\/gemini\/.*$/, async (req, res) => {
  try {
    // Extract model name from URL path
    const pathParts = req.path.split('/');
    const model = pathParts[pathParts.length - 1].replace(':streamGenerateContent?alt=sse', '');

    // This is a proxy - in production you'd forward to actual Gemini API
    // For now, return a mock streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const mockResponse = 'This is a mock response from the Gemini proxy.';
    res.write(`data: ${JSON.stringify({
      candidates: [{
        content: { parts: [{ text: mockResponse }] }
      }]
    })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Gemini proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to generate timepoints
function generateTimepoints(words, totalDuration) {
  const wordCount = words.length;
  let fakeTimepoints = [];
  
  if (wordCount > 0) {
    // Calculate word durations based on word length (longer words take longer)
    let currentTime = 0;
    
    fakeTimepoints = words.map((word, index) => {
      // Calculate word weight based on length and complexity
      const wordLength = word.length;
      const weight = Math.max(1, wordLength / 3); // Longer words get more time
      
      // Calculate duration for this word
      const totalWeight = words.reduce((sum, w) => sum + Math.max(1, w.length / 3), 0);
      const wordDuration = (weight / totalWeight) * totalDuration;
      
      const timepoint = {
        markName: "" + index,
        timeSeconds: currentTime
      };
      
      currentTime += wordDuration;
      return timepoint;
    });
  }
  
  return fakeTimepoints;
}

// Google TTS proxy endpoint
app.post('/gtts/', async (req, res) => {
  try {
    const { input, voice, audioConfig } = req.body;

    // Extract text from SSML or text field
    let text = '';
    if (input && input.ssml) {
      text = input.ssml.replace(/<[^>]+>/g, '').trim();
    } else if (input && input.text) {
      text = input.text;
    } else {
      text = req.body.text || '';
    }

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`TTS request: ${text.substring(0, 50)}...`);

    // Split text into words for timepoints
    const words = text.split(/\s+/);

    // Generate a unique filename
    const filename = `tts_${Date.now()}.aiff`;
    const filepath = path.join(__dirname, 'temp', filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    }

    // Get voice name from request or use default
    const voiceName = voice && voice.name ? voice.name : 'Samantha';
    // Use slower rate for better lip-sync (default 0.6 instead of 200)
    const rate = audioConfig && audioConfig.speakingRate ? audioConfig.speakingRate * 120 : 120;

    // Use macOS say command for TTS
    const command = `say "${text}" -o "${filepath}" -v "${voiceName}" -r ${rate}`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('TTS error:', error);
        console.error('stderr:', stderr);
        return res.status(500).json({ error: 'TTS failed: ' + error.message });
      }

      // Check if file exists
      if (!fs.existsSync(filepath)) {
        console.error('Audio file not created:', filepath);
        return res.status(500).json({ error: 'Audio file not created' });
      }

      console.log('Audio file created:', filepath);

      // Convert AIFF to MP3 using ffmpeg
      const mp3File = filepath.replace('.aiff', '.mp3');
      const ffmpegCommand = `ffmpeg -i "${filepath}" -acodec libmp3lame -ab 128k "${mp3File}" -y`;

      exec(ffmpegCommand, (ffmpegError, ffmpegStdout, ffmpegStderr) => {
        if (ffmpegError) {
          console.error('FFmpeg error:', ffmpegError);
          return res.status(500).json({ error: 'Audio conversion failed' });
        }

        console.log('Audio converted to MP3:', mp3File);

        // Read the MP3 file and convert to base64
        const audioBuffer = fs.readFileSync(mp3File);
        const audioBase64 = audioBuffer.toString('base64');

        // Get audio duration using ffprobe
        exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp3File}"`, (probeError, stdout, stderr) => {
          if (probeError) {
            console.error('FFprobe error:', probeError);
            // Fallback to 1 second if ffprobe fails
            const totalDuration = 1.0;
            const fakeTimepoints = generateTimepoints(words, totalDuration);
            res.json({
              audioContent: audioBase64,
              timepoints: fakeTimepoints
            });
            return;
          }

          const audioDuration = parseFloat(stdout.trim());
          console.log('Audio duration:', audioDuration, 'seconds');

          // Generate timepoints scaled to actual audio duration
          const fakeTimepoints = generateTimepoints(words, audioDuration);

          res.json({
            audioContent: audioBase64,
            timepoints: fakeTimepoints
          });

          // Clean up files after sending
          setTimeout(() => {
            try {
              if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
              if (fs.existsSync(mp3File)) fs.unlinkSync(mp3File);
            } catch (e) {
              console.error('Error deleting temp files:', e);
            }
          }, 1000);
        });
      });
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Static files served from: ${__dirname}`);
  console.log(`API endpoints available:`);
  console.log(`  - GET  /app/jwt/get`);
  console.log(`  - POST /openai/v1/chat/completions`);
  console.log(`  - POST /gemini/*`);
});
