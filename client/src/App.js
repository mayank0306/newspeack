import React, { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [statusText, setStatusText] = useState('Click the button to start recording.');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Timer effect
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    setAnalysisResult(null); // Clear previous results
    setRecordingTime(0); // Reset timer
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendAudioToServer(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusText('Recording... Click to stop.');
    } catch (err) {
      console.error('Error starting recording:', err);
      setStatusText('Microphone access denied. Please allow access and try again.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusText('Processing your speech... this may take a moment.');
    }
  };

  const sendAudioToServer = async (audioBlob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
      console.log('Sending audio to server...', 'Size:', audioBlob.size, 'bytes');
      setStatusText('Sending audio for analysis...');
      
      const response = await fetch('http://localhost:8000/api/analyze', {
        method: 'POST',
        body: formData,
      });

      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Server error:', errorData);
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Analysis result:', data);
      setAnalysisResult(data);
      setStatusText('Click the button to start a new recording.');

    } catch (error) {
      console.error('Error sending audio to server:', error);
      let errorMessage = 'Error during analysis. Please try again.';
      
      if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Cannot connect to server. Please make sure the server is running.';
      } else if (error.message.includes('API authentication failed')) {
        errorMessage = 'Server configuration error. Please contact support.';
      } else if (error.message.includes('transcription failed')) {
        errorMessage = 'Speech recognition failed. Please try speaking more clearly.';
      } else if (error.message.includes('timed out')) {
        errorMessage = 'Analysis timed out. Please try with a shorter recording.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setStatusText(errorMessage);
    }
  };

  const handleRecordButtonClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>SpeakEasy 🎙️</h1>
        <p>Your Personal AI-Powered Speaking Coach</p>
      </header>

      <div className="card">
        <div className="card-header">
          <h2>Practice Your Speech</h2>
        </div>
        <div className="card-body">
          <div className="recording-container">
            <div className="timer-display">
              {isRecording && <span className="timer">{formatTime(recordingTime)}</span>}
            </div>
            <button onClick={handleRecordButtonClick} className={`record-button ${isRecording ? 'recording' : ''}`}>
              <div className="record-button-inner">
                {isRecording ? (
                  <div className="stop-icon"></div>
                ) : (
                  <div className="record-icon"></div>
                )}
              </div>
            </button>
            <p className="status-text">{statusText}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Analysis Results</h2>
        </div>
        <div className="card-body">
          {analysisResult ? (
            <div className="results-grid">
              <div className="result-item">
                <h3>Pacing</h3>
                <p className="result-value">{analysisResult.wordsPerMinute} WPM</p>
              </div>
              <div className="result-item">
                <h3>Filler Words</h3>
                <p className="result-value">{analysisResult.fillerWordCount}</p>
              </div>
              <div className="result-item">
                <h3>Suggestions</h3>
                {(() => {
                  const wpm = analysisResult.wordsPerMinute || 0;
                  let pacingSuggestion = '';
                  if (wpm > 160) {
                    pacingSuggestion = 'Your pace is too fast. Slow down a bit so listeners can follow.';
                  } else if (wpm < 140) {
                    pacingSuggestion = 'Your pace is too slow. Speed up a bit to keep engagement.';
                  } else {
                    pacingSuggestion = 'Pacing looks great — you are good to go now!';
                  }

                  const minutes = Math.max(recordingTime, 1) / 60; // avoid divide-by-zero
                  const fillerPerMinute = minutes > 0 ? (analysisResult.fillerWordCount || 0) / minutes : 0;
                  const fillerSuggestion = fillerPerMinute > 2
                    ? 'Reduce utterances (um/uh/like). Aim for fewer than 2 per minute.'
                    : 'Nice control of filler words.';

                  return (
                    <div>
                      <p>{pacingSuggestion}</p>
                      <p>{fillerSuggestion}</p>
                    </div>
                  );
                })()}
              </div>
              <div className="result-item transcript">
                <h3>Transcript</h3>
                <p>{analysisResult.transcript}</p>
              </div>
            </div>
          ) : (
            <p className="results-placeholder">Your analysis will appear here after you finish recording.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;