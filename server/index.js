require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// AssemblyAI API Configuration
const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
if (!apiKey) {
    console.error('ASSEMBLYAI_API_KEY is not set or empty');
    process.exit(1);
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        apiKey: apiKey ? 'Set' : 'Not set'
    });
});

const assemblyai = axios.create({
    baseURL: 'https://api.assemblyai.com/v2',
    headers: {
        authorization: apiKey,
    },
});

app.post('/api/analyze', upload.single('audio'), async (req, res) => {
    console.log("=== Speech Analysis Request Started ===");
    console.log("Request received at:", new Date().toISOString());

    if (!req.file) {
        console.error("No file uploaded in request");
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    const filePath = req.file.path;
    console.log("File uploaded:", req.file.originalname, "Size:", req.file.size, "bytes");

    try {
        // Step 1: Upload the local file to AssemblyAI.
        console.log("Step 1: Uploading file to AssemblyAI...");
        const uploadResponse = await assemblyai.post('/upload', fs.readFileSync(filePath));
        const uploadUrl = uploadResponse.data.upload_url;
        console.log("File uploaded successfully. URL:", uploadUrl);

        // Step 2: Request the transcription, explicitly setting the content-type to JSON.
        console.log("Step 2: Requesting transcription...");
        const transcriptResponse = await assemblyai.post('/transcript', {
            audio_url: uploadUrl
        }, { headers: { 'content-type': 'application/json' } });
        const transcriptId = transcriptResponse.data.id;
        console.log("Transcription requested. ID:", transcriptId);

        // Step 3: Poll for the transcription to complete
        console.log("Step 3: Polling for transcription completion...");
        let transcriptData;
        let pollCount = 0;
        const maxPolls = 20; // Maximum 60 seconds (20 * 3 seconds)
        
        while (pollCount < maxPolls) {
            const pollResponse = await assemblyai.get(`/transcript/${transcriptId}`);
            transcriptData = pollResponse.data;
            console.log(`Poll ${pollCount + 1}: Status = ${transcriptData.status}`);
            
            if (transcriptData.status === 'completed') {
                console.log("Transcription completed successfully!");
                break;
            } else if (transcriptData.status === 'error') {
                console.error("Transcription failed:", transcriptData.error);
                throw new Error(`Transcription failed: ${transcriptData.error}`);
            }
            
            pollCount++;
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        
        if (pollCount >= maxPolls) {
            throw new Error('Transcription timed out after 60 seconds');
        }

        // Step 4: Perform our custom analysis
        console.log("Step 4: Performing speech analysis...");
        const transcriptText = transcriptData.text || '';
        const audioDuration = transcriptData.audio_duration / 60; // in minutes
        console.log(`Audio duration: ${audioDuration.toFixed(2)} minutes`);

        // Pacing analysis - count words from transcript text
        const words = transcriptText.split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;
        console.log(`Total words: ${wordCount}`);
        // Safety check to prevent division by zero for very short audio
        const wordsPerMinute = audioDuration > 0 ? Math.round(wordCount / audioDuration) : 0;
        console.log(`Words per minute: ${wordsPerMinute}`);

        // Filler word analysis - search in transcript text
        const fillerWordsList = ['um', 'uh', 'like', 'so', 'you know', 'actually', 'basically', 'ahh','ummmm','uhhhh'];
        const fillerWordCount = fillerWordsList.reduce((count, filler) => {
            const regex = new RegExp(`\\b${filler}\\b`, 'gi');
            const matches = transcriptText.match(regex);
            return count + (matches ? matches.length : 0);
        }, 0);
        console.log(`Filler words found: ${fillerWordCount}`);

        // Suggestions Engine
        // Pacing suggestions based on words per minute
        let pacingSuggestion;
        if (wordsPerMinute > 160) {
            pacingSuggestion = "Your pace is quite fast. Try speaking a bit more slowly to ensure your audience can follow along.";
        } else if (wordsPerMinute < 130) {
            pacingSuggestion = "Your pace is a little slow. Try speaking a bit faster to keep your audience engaged.";
        } else {
            pacingSuggestion = "Your pacing is excellent! It's right in the ideal range for presentations.";
        }

        // Long pause detection using word-level timestamps from AssemblyAI (if available)
        let longPauseCount = 0;
        const wordsWithTimestamps = Array.isArray(transcriptData.words) ? transcriptData.words : [];
        for (let i = 1; i < wordsWithTimestamps.length; i++) {
            const previousWord = wordsWithTimestamps[i - 1];
            const currentWord = wordsWithTimestamps[i];
            const prevEnd = typeof previousWord?.end === 'number' ? previousWord.end : null;
            const currStart = typeof currentWord?.start === 'number' ? currentWord.start : null;
            if (prevEnd !== null && currStart !== null) {
                let diff = currStart - prevEnd; // AssemblyAI provides ms; normalize to seconds if needed
                const pauseSeconds = diff > 100 ? diff / 1000 : diff;
                if (pauseSeconds > 2.0) {
                    longPauseCount++;
                }
            }
        }

        // Pause & filler word suggestions
        let pauseSuggestion;
        if (longPauseCount > 3) {
            pauseSuggestion = `You paused for over 2 seconds ${longPauseCount} times. Try to make your transitions between sentences smoother.`;
        } else if (fillerWordCount > 5) {
            pauseSuggestion = `You used ${fillerWordCount} filler words. Practice your speech to reduce reliance on words like 'um' and 'like'.`;
        } else {
            pauseSuggestion = "Great job on maintaining a smooth flow with minimal long pauses!";
        }

        // Send the final analysis back to the client
        console.log("Analysis complete! Sending results to client...");
        res.json({
            message: 'Analysis complete!',
            transcript: transcriptText,
            wordsPerMinute,
            fillerWordCount,
            suggestions: {
                pacing: pacingSuggestion,
                pauses: pauseSuggestion,
            },
        });

    } catch (error) {
        console.error('=== ERROR DURING ANALYSIS ===');
        console.error('Error message:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        console.error('Stack trace:', error.stack);
        
        // Send more specific error message to client
        let errorMessage = 'An error occurred during analysis.';
        if (error.message.includes('Transcription failed')) {
            errorMessage = 'Speech transcription failed. Please try again.';
        } else if (error.message.includes('timed out')) {
            errorMessage = 'Analysis timed out. Please try with a shorter recording.';
        } else if (error.response?.status === 401) {
            errorMessage = 'API authentication failed. Please check server configuration.';
        }
        
        res.status(500).json({ 
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // Step 5: Clean up by deleting the temporary file
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log("Temporary file cleaned up successfully");
            }
        } catch (cleanupError) {
            console.error("Error cleaning up temporary file:", cleanupError.message);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});


