const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// TTS endpoint
app.post('/tts', async (req, res) => {
  try {
    // Handle Google Cloud TTS format
    const { input, voice, audioConfig } = req.body;
    
    // Extract text from SSML or text field
    let text = '';
    if (input && input.ssml) {
      // Remove SSML tags to get plain text
      text = input.ssml.replace(/<[^>]+>/g, '').trim();
    } else if (input && input.text) {
      text = input.text;
    } else {
      // Fallback to simple text field
      text = req.body.text || '';
    }
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`TTS request: ${text.substring(0, 50)}...`);

    // Generate a unique filename
    const filename = `tts_${Date.now()}.aiff`;
    const filepath = path.join(__dirname, 'temp', filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    }

    // Get voice name from request or use default
    const voiceName = voice && voice.name ? voice.name : 'Samantha';
    const rate = audioConfig && audioConfig.speakingRate ? audioConfig.speakingRate * 200 : 200;

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

        // Send JSON response with audioContent and timepoints fields
        res.json({
          audioContent: audioBase64,
          timepoints: []  // Empty timepoints - TalkingHead will handle this
        });

        // Clean up files after sending
        setTimeout(() => {
          try {
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath);
              console.log('Deleted temp file:', filepath);
            }
            if (fs.existsSync(mp3File)) {
              fs.unlinkSync(mp3File);
              console.log('Deleted temp file:', mp3File);
            }
          } catch (e) {
            console.error('Error deleting temp files:', e);
          }
        }, 1000);
      });
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`TTS Server running on http://localhost:${PORT}`);
  console.log(`TTS endpoint: http://localhost:${PORT}/tts`);
});
