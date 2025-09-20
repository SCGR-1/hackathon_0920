class RealtimeDemo {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isMuted = false;
        this.isCapturing = false;
        this.audioContext = null;
        this.processor = null;
        this.stream = null;
        this.sessionId = this.generateSessionId();
        
        // Audio playback queue
        this.audioQueue = [];
        this.isPlayingAudio = false;
        this.playbackAudioContext = null;
        this.currentAudioSource = null;
        
        // MeetStream bot management
        this.currentBot = null;
        this.meetstreamApiKey = null;
        
        // Transcription management
        this.transcriptionWs = null;
        this.transcriptions = [];
        
        this.initializeElements();
        this.setupEventListeners();
        this.updateSessionInfo();
        // Show HTTPS/localhost warning if needed
        this.showInsecureBannerIfNeeded();
    }
    
    initializeElements() {
        this.connectBtn = document.getElementById('connectBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.status = document.getElementById('status');
        this.messagesContent = document.getElementById('messagesContent');
        this.eventsContent = document.getElementById('eventsContent');
        this.toolsContent = document.getElementById('toolsContent');
        
        // MeetStream elements
        this.meetingLink = document.getElementById('meetingLink');
        this.botName = document.getElementById('botName');
        this.botMessage = document.getElementById('botMessage');
        this.createBotBtn = document.getElementById('createBotBtn');
        this.removeBotBtn = document.getElementById('removeBotBtn');
        this.botStatus = document.getElementById('botStatus');
        this.botInfo = document.getElementById('botInfo');
        this.sessionInfo = document.getElementById('sessionInfo');
        
        // Transcription elements
        this.transcriptionStatus = document.getElementById('transcriptionStatus');
        this.transcriptionList = document.getElementById('transcriptionList');
        this.testTranscriptionBtn = document.getElementById('testTranscriptionBtn');
        this.fetchTranscriptionBtn = document.getElementById('fetchTranscriptionBtn');
        this.manualTranscriptionInput = document.getElementById('manualTranscriptionInput');
        this.manualTranscriptionBtn = document.getElementById('manualTranscriptionBtn');
    }
    
    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => {
            if (this.isConnected) {
                this.disconnect();
            } else {
                this.connect();
            }
        });
        
        this.muteBtn.addEventListener('click', () => {
            this.toggleMute();
        });
        
        // MeetStream event listeners
        this.createBotBtn.addEventListener('click', () => {
            this.createMeetStreamBot();
        });
        
        this.removeBotBtn.addEventListener('click', () => {
            this.removeMeetStreamBot();
        });
        
        // Connect to transcription WebSocket when main connection is established
        this.connectTranscription();
        
        // Test transcription button
        this.testTranscriptionBtn.addEventListener('click', () => {
            this.testTranscription();
        });
        
        // Fetch transcriptions button
        this.fetchTranscriptionBtn.addEventListener('click', () => {
            this.fetchTranscriptions();
        });
        
        // Manual transcription button
        this.manualTranscriptionBtn.addEventListener('click', () => {
            this.addManualTranscription();
        });
    }
    
    generateSessionId() {
        return 'session_' + Math.random().toString(36).substr(2, 9);
    }
    
    async connect() {
        try {
            this.ws = new WebSocket(`ws://localhost:8000/ws/${this.sessionId}`);
            
            this.ws.onopen = () => {
                this.isConnected = true;
                this.updateConnectionUI();
                if (this.isSecureForMic()) {
                    this.startContinuousCapture();
                } else {
                    this.addMessage('assistant', 'Connected ✅ — but mic capture is disabled on HTTP. Switch to HTTPS to enable audio.');
                }
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleRealtimeEvent(data);
            };
            
            this.ws.onclose = () => {
                this.isConnected = false;
                this.updateConnectionUI();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
        } catch (error) {
            console.error('Failed to connect:', error);
        }
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        this.stopContinuousCapture();
    }
    
    updateConnectionUI() {
        if (this.isConnected) {
            this.connectBtn.textContent = 'Disconnect';
            this.connectBtn.className = 'connect-btn connected';
            this.status.textContent = 'Connected';
            this.status.className = 'status connected';
            this.muteBtn.disabled = false;
        } else {
            this.connectBtn.textContent = 'Connect';
            this.connectBtn.className = 'connect-btn disconnected';
            this.status.textContent = 'Disconnected';
            this.status.className = 'status disconnected';
            this.muteBtn.disabled = true;
        }
    }
    
    toggleMute() {
        this.isMuted = !this.isMuted;
        this.updateMuteUI();
    }
    
    updateMuteUI() {
        if (this.isMuted) {
            this.muteBtn.textContent = '🔇 Mic Off';
            this.muteBtn.className = 'mute-btn muted';
        } else {
            this.muteBtn.textContent = '🎤 Mic On';
            this.muteBtn.className = 'mute-btn unmuted';
            if (this.isCapturing) {
                this.muteBtn.classList.add('active');
            }
        }
    }
    
    async startContinuousCapture() {
        if (!this.isConnected || this.isCapturing) return;
        
        // Check if getUserMedia is available and we are in a secure context
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !this.isSecureForMic()) {
            console.warn('Microphone capture requires HTTPS or localhost. Skipping mic start.');
            this.addMessage('assistant', '🎙️ Mic is unavailable because this page is not being served over HTTPS (or localhost). Connect is fine, but I won’t capture audio until you switch to HTTPS.');
            this.showInsecureBannerIfNeeded();
            return; // Do not throw; allow the app to keep running without mic
        }
        
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 24000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });
            
            this.audioContext = new AudioContext({ sampleRate: 24000 });
            const source = this.audioContext.createMediaStreamSource(this.stream);
            
            // Create a script processor to capture audio data
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
            this.processor.onaudioprocess = (event) => {
                if (!this.isMuted && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const inputBuffer = event.inputBuffer.getChannelData(0);
                    const int16Buffer = new Int16Array(inputBuffer.length);
                    
                    // Convert float32 to int16
                    for (let i = 0; i < inputBuffer.length; i++) {
                        int16Buffer[i] = Math.max(-32768, Math.min(32767, inputBuffer[i] * 32768));
                    }
                    
                    this.ws.send(JSON.stringify({
                        type: 'audio',
                        data: Array.from(int16Buffer)
                    }));
                }
            };
            
            this.isCapturing = true;
            this.updateMuteUI();
            
        } catch (error) {
            console.error('Failed to start audio capture:', error);
        }
    }
    
    stopContinuousCapture() {
        if (!this.isCapturing) return;
        
        this.isCapturing = false;
        
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.updateMuteUI();
    }
    
    handleRealtimeEvent(event) {
        // Add to raw events pane
        this.addRawEvent(event);
        
        // Add to tools panel if it's a tool or handoff event
        if (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'handoff') {
            this.addToolEvent(event);
        }
        
        // Handle specific event types
        switch (event.type) {
            case 'audio':
                this.playAudio(event.audio);
                break;
            case 'audio_interrupted':
                this.stopAudioPlayback();
                break;
            case 'history_updated':
                this.updateMessagesFromHistory(event.history);
                break;
        }
    }
    
    
    updateMessagesFromHistory(history) {
        console.log('updateMessagesFromHistory called with:', history);
        
        // Clear all existing messages
        this.messagesContent.innerHTML = '';
        
        // Add messages from history
        if (history && Array.isArray(history)) {
            console.log('Processing history array with', history.length, 'items');
            history.forEach((item, index) => {
                console.log(`History item ${index}:`, item);
                if (item.type === 'message') {
                    const role = item.role;
                    let content = '';
                    
                    console.log(`Message item - role: ${role}, content:`, item.content);
                    
                    if (item.content && Array.isArray(item.content)) {
                        // Extract text from content array
                        item.content.forEach(contentPart => {
                            console.log('Content part:', contentPart);
                            if (contentPart.type === 'text' && contentPart.text) {
                                content += contentPart.text;
                            } else if (contentPart.type === 'input_text' && contentPart.text) {
                                content += contentPart.text;
                            } else if (contentPart.type === 'input_audio' && contentPart.transcript) {
                                content += contentPart.transcript;
                            } else if (contentPart.type === 'audio' && contentPart.transcript) {
                                content += contentPart.transcript;
                            }
                        });
                    }
                    
                    console.log(`Final content for ${role}:`, content);
                    
                    if (content.trim()) {
                        this.addMessage(role, content.trim());
                        console.log(`Added message: ${role} - ${content.trim()}`);
                    }
                } else {
                    console.log(`Skipping non-message item of type: ${item.type}`);
                }
            });
        } else {
            console.log('History is not an array or is null/undefined');
        }
        
        this.scrollToBottom();
    }
    
    addMessage(type, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';
        bubbleDiv.textContent = content;
        
        messageDiv.appendChild(bubbleDiv);
        this.messagesContent.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }
    
    addRawEvent(event) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'event';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'event-header';
        headerDiv.innerHTML = `
            <span>${event.type}</span>
            <span>▼</span>
        `;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'event-content collapsed';
        contentDiv.textContent = JSON.stringify(event, null, 2);
        
        headerDiv.addEventListener('click', () => {
            const isCollapsed = contentDiv.classList.contains('collapsed');
            contentDiv.classList.toggle('collapsed');
            headerDiv.querySelector('span:last-child').textContent = isCollapsed ? '▲' : '▼';
        });
        
        eventDiv.appendChild(headerDiv);
        eventDiv.appendChild(contentDiv);
        this.eventsContent.appendChild(eventDiv);
        
        // Auto-scroll events pane
        this.eventsContent.scrollTop = this.eventsContent.scrollHeight;
    }
    
    addToolEvent(event) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'event';
        
        let title = '';
        let description = '';
        let eventClass = '';
        
        if (event.type === 'handoff') {
            title = `🔄 Handoff`;
            description = `From ${event.from} to ${event.to}`;
            eventClass = 'handoff';
        } else if (event.type === 'tool_start') {
            title = `🔧 Tool Started`;
            description = `Running ${event.tool}`;
            eventClass = 'tool';
        } else if (event.type === 'tool_end') {
            title = `✅ Tool Completed`;
            description = `${event.tool}: ${event.output || 'No output'}`;
            eventClass = 'tool';
        }
        
        eventDiv.innerHTML = `
            <div class="event-header ${eventClass}">
                <div>
                    <div style="font-weight: 600; margin-bottom: 2px;">${title}</div>
                    <div style="font-size: 0.8rem; opacity: 0.8;">${description}</div>
                </div>
                <span style="font-size: 0.7rem; opacity: 0.6;">${new Date().toLocaleTimeString()}</span>
            </div>
        `;
        
        this.toolsContent.appendChild(eventDiv);
        
        // Auto-scroll tools pane
        this.toolsContent.scrollTop = this.toolsContent.scrollHeight;
    }
    
    async playAudio(audioBase64) {
        try {
            if (!audioBase64 || audioBase64.length === 0) {
                console.warn('Received empty audio data, skipping playback');
                return;
            }
            
            // Add to queue
            this.audioQueue.push(audioBase64);
            
            // Start processing queue if not already playing
            if (!this.isPlayingAudio) {
                this.processAudioQueue();
            }
            
        } catch (error) {
            console.error('Failed to play audio:', error);
        }
    }
    
    async processAudioQueue() {
        if (this.isPlayingAudio || this.audioQueue.length === 0) {
            return;
        }
        
        this.isPlayingAudio = true;
        
        // Initialize audio context if needed
        if (!this.playbackAudioContext) {
            this.playbackAudioContext = new AudioContext({ sampleRate: 24000 });
        }
        
        while (this.audioQueue.length > 0) {
            const audioBase64 = this.audioQueue.shift();
            await this.playAudioChunk(audioBase64);
        }
        
        this.isPlayingAudio = false;
    }
    
    async playAudioChunk(audioBase64) {
        return new Promise((resolve, reject) => {
            try {
                // Decode base64 to ArrayBuffer
                const binaryString = atob(audioBase64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                const int16Array = new Int16Array(bytes.buffer);
                
                if (int16Array.length === 0) {
                    console.warn('Audio chunk has no samples, skipping');
                    resolve();
                    return;
                }
                
                const float32Array = new Float32Array(int16Array.length);
                
                // Convert int16 to float32
                for (let i = 0; i < int16Array.length; i++) {
                    float32Array[i] = int16Array[i] / 32768.0;
                }
                
                const audioBuffer = this.playbackAudioContext.createBuffer(1, float32Array.length, 24000);
                audioBuffer.getChannelData(0).set(float32Array);
                
                const source = this.playbackAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.playbackAudioContext.destination);
                
                // Store reference to current source
                this.currentAudioSource = source;
                
                source.onended = () => {
                    this.currentAudioSource = null;
                    resolve();
                };
                source.start();
                
            } catch (error) {
                console.error('Failed to play audio chunk:', error);
                reject(error);
            }
        });
    }
    
    stopAudioPlayback() {
        console.log('Stopping audio playback due to interruption');
        
        // Stop current audio source if playing
        if (this.currentAudioSource) {
            try {
                this.currentAudioSource.stop();
                this.currentAudioSource = null;
            } catch (error) {
                console.error('Error stopping audio source:', error);
            }
        }
        
        // Clear the audio queue
        this.audioQueue = [];
        
        // Reset playback state
        this.isPlayingAudio = false;
        
        console.log('Audio playback stopped and queue cleared');
    }
    
    scrollToBottom() {
        this.messagesContent.scrollTop = this.messagesContent.scrollHeight;
    }

    // Returns true if HTTPS or localhost or secure context for microphone
    isSecureForMic() {
        const hn = window.location.hostname;
        if (window.isSecureContext) return true;
        if (hn === 'localhost' || hn === '127.0.0.1' || hn.endsWith('.localhost')) return true;
        return false;
    }

    showInsecureBannerIfNeeded() {
        const banner = document.getElementById('insecureWarning');
        const link = document.getElementById('tryHttpsLink');
        if (!banner) return;
        if (!this.isSecureForMic()) {
            banner.style.display = 'block';
            if (link) {
                try {
                    // Offer an HTTPS link to same host/path
                    const httpsUrl = new URL(window.location.href);
                    httpsUrl.protocol = 'https:';
                    link.href = httpsUrl.toString();
                    link.onclick = (e) => {
                        // allow default navigation
                    };
                } catch {}
            }
        } else {
            banner.style.display = 'none';
        }
    }
    
    // MeetStream Bot Management
    async createMeetStreamBot() {
        const meetingLink = this.meetingLink.value.trim();
        const botName = this.botName.value.trim();
        const botMessage = this.botMessage.value.trim();
        
        if (!meetingLink) {
            alert('Please enter a meeting link');
            return;
        }
        
        // API key will be handled by the server using .env file
        
        this.createBotBtn.disabled = true;
        this.createBotBtn.textContent = 'Creating...';
        
        try {
            const response = await fetch('/api/meetstream/create-bot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    meeting_link: meetingLink,
                    bot_name: botName,
                    bot_message: botMessage
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            this.currentBot = result;
            
            this.updateBotStatus('online', `Bot created: ${result.bot_id}`);
            this.removeBotBtn.disabled = false;
            this.botInfo.textContent = `Bot ID: ${result.bot_id} | Transcript ID: ${result.transcript_id}`;
            
        } catch (error) {
            console.error('Failed to create bot:', error);
            alert(`Failed to create bot: ${error.message}`);
            this.updateBotStatus('offline', 'Failed to create bot');
        } finally {
            this.createBotBtn.disabled = false;
            this.createBotBtn.textContent = 'Create Bot';
        }
    }
    
    async removeMeetStreamBot() {
        if (!this.currentBot) return;
        
        this.removeBotBtn.disabled = true;
        this.removeBotBtn.textContent = 'Removing...';
        
        try {
            const response = await fetch('/api/meetstream/remove-bot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    bot_id: this.currentBot.bot_id
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.detail || `HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.currentBot = null;
            this.updateBotStatus('offline', 'Bot removed and exited call');
            this.removeBotBtn.disabled = true;
            this.botInfo.textContent = '';
            
            // Show success message
            alert('Bot has been removed and exited the meeting call!');
            
        } catch (error) {
            console.error('Failed to remove bot:', error);
            alert(`Failed to remove bot: ${error.message}`);
        } finally {
            this.removeBotBtn.disabled = false;
            this.removeBotBtn.textContent = 'Remove Bot';
        }
    }
    
    updateBotStatus(status, message) {
        const indicator = this.botStatus.querySelector('.status-indicator');
        const text = this.botStatus.querySelector('span:last-child');
        
        indicator.className = `status-indicator status-${status}`;
        text.textContent = message;
    }
    
    updateSessionInfo() {
        const info = {
            'Session ID': this.sessionId,
            'WebSocket URL': `ws://${window.location.host}/ws/${this.sessionId}`,
            'Control URL': `ws://${window.location.host}/bridge`,
            'Audio URL': `ws://${window.location.host}/bridge/audio`,
            'Transcription URL': `ws://${window.location.host}/ws/transcription`,
            'Connection Status': this.isConnected ? 'Connected' : 'Disconnected',
            'Microphone': this.isCapturing ? 'Active' : 'Inactive',
            'Transcription': this.transcriptionWs && this.transcriptionWs.readyState === WebSocket.OPEN ? 'Active' : 'Inactive'
        };
        
        this.sessionInfo.innerHTML = Object.entries(info)
            .map(([key, value]) => `<div><strong>${key}:</strong> ${value}</div>`)
            .join('');
    }
    
    // Transcription Management
    connectTranscription() {
        try {
            this.transcriptionWs = new WebSocket(`ws://${window.location.host}/ws/transcription`);
            
            this.transcriptionWs.onopen = () => {
                this.updateTranscriptionStatus('online', 'Connected to transcription');
                this.updateSessionInfo();
            };
            
            this.transcriptionWs.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleTranscriptionData(data);
            };
            
            this.transcriptionWs.onclose = () => {
                this.updateTranscriptionStatus('offline', 'Transcription disconnected');
                this.updateSessionInfo();
                // Reconnect after 3 seconds
                setTimeout(() => this.connectTranscription(), 3000);
            };
            
            this.transcriptionWs.onerror = (error) => {
                console.error('Transcription WebSocket error:', error);
                this.updateTranscriptionStatus('offline', 'Transcription error');
            };
            
        } catch (error) {
            console.error('Failed to connect transcription WebSocket:', error);
        }
    }
    
    handleTranscriptionData(data) {
        if (data.type === 'transcription_history') {
            this.transcriptions = data.data;
            this.renderTranscriptions();
        } else if (data.type === 'transcription_update') {
            this.transcriptions.push(data.data);
            this.renderTranscriptions();
            this.updateTranscriptionStatus('online', `${this.transcriptions.length} transcriptions received`);
        }
    }
    
    renderTranscriptions() {
        if (!this.transcriptionList) return;
        
        this.transcriptionList.innerHTML = this.transcriptions
            .slice(-20) // Show last 20 entries
            .map(transcription => `
                <div class="transcription-entry ${transcription.id === this.transcriptions.length - 1 ? 'new' : ''}">
                    <div class="transcription-speaker">${transcription.speaker}</div>
                    <div class="transcription-text">${transcription.text}</div>
                    <div class="transcription-meta">
                        <span>${new Date(transcription.received_at).toLocaleTimeString()}</span>
                        <span>Confidence: ${(transcription.confidence * 100).toFixed(1)}%</span>
                    </div>
                </div>
            `).join('');
        
        // Auto-scroll to bottom
        this.transcriptionList.scrollTop = this.transcriptionList.scrollHeight;
    }
    
    updateTranscriptionStatus(status, message) {
        if (!this.transcriptionStatus) return;
        
        const indicator = this.transcriptionStatus.querySelector('.status-indicator');
        const text = this.transcriptionStatus.querySelector('span:last-child');
        
        if (indicator && text) {
            indicator.className = `status-indicator status-${status}`;
            text.textContent = message;
        }
    }
    
    async testTranscription() {
        try {
            this.testTranscriptionBtn.disabled = true;
            this.testTranscriptionBtn.textContent = 'Testing...';
            
            const response = await fetch('/api/test-transcription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (response.ok) {
                alert('Test transcription successful! Check the transcription panel.');
            } else {
                alert('Test transcription failed: ' + result.error);
            }
            
        } catch (error) {
            console.error('Test transcription error:', error);
            alert('Test transcription error: ' + error.message);
        } finally {
            this.testTranscriptionBtn.disabled = false;
            this.testTranscriptionBtn.textContent = 'Test Transcription';
        }
    }
    
    async fetchTranscriptions() {
        try {
            this.fetchTranscriptionBtn.disabled = true;
            this.fetchTranscriptionBtn.textContent = 'Fetching...';
            
            const response = await fetch('/api/transcription', {
                method: 'GET'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.transcriptions = result.transcriptions || [];
                this.renderTranscriptions();
                this.updateTranscriptionStatus('online', `${this.transcriptions.length} transcriptions loaded`);
                alert(`Fetched ${this.transcriptions.length} transcriptions from server!`);
            } else {
                alert('Failed to fetch transcriptions: ' + result.error);
            }
            
        } catch (error) {
            console.error('Fetch transcriptions error:', error);
            alert('Fetch transcriptions error: ' + error.message);
        } finally {
            this.fetchTranscriptionBtn.disabled = false;
            this.fetchTranscriptionBtn.textContent = 'Fetch Transcriptions';
        }
    }
    
    async addManualTranscription() {
        try {
            const jsonData = this.manualTranscriptionInput.value.trim();
            if (!jsonData) {
                alert('Please paste the webhook.site JSON data first');
                return;
            }
            
            this.manualTranscriptionBtn.disabled = true;
            this.manualTranscriptionBtn.textContent = 'Adding...';
            
            // Parse the JSON data
            const webhookData = JSON.parse(jsonData);
            
            const response = await fetch('/api/manual-transcription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(webhookData)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                alert('Manual transcription added successfully! Check the transcription panel.');
                this.manualTranscriptionInput.value = ''; // Clear the input
            } else {
                alert('Manual transcription failed: ' + result.error);
            }
            
        } catch (error) {
            console.error('Manual transcription error:', error);
            alert('Manual transcription error: ' + error.message);
        } finally {
            this.manualTranscriptionBtn.disabled = false;
            this.manualTranscriptionBtn.textContent = 'Add Manual Transcription';
        }
    }
}

// Tool testing functions
async function testWeather() {
    const resultDiv = document.getElementById('weatherResult');
    resultDiv.textContent = 'Testing weather tool...';
    
    try {
        const response = await fetch('/api/test-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'weather_now', params: { city: 'New York' } })
        });
        
        const result = await response.json();
        resultDiv.textContent = result.success ? result.output : `Error: ${result.error}`;
    } catch (error) {
        resultDiv.textContent = `Error: ${error.message}`;
    }
}

async function testTime() {
    const resultDiv = document.getElementById('timeResult');
    resultDiv.textContent = 'Testing time tool...';
    
    try {
        const response = await fetch('/api/test-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'current_time', params: { timezone_name: 'America/New_York' } })
        });
        
        const result = await response.json();
        resultDiv.textContent = result.success ? result.output : `Error: ${result.error}`;
    } catch (error) {
        resultDiv.textContent = `Error: ${error.message}`;
    }
}

async function testCanva() {
    const resultDiv = document.getElementById('canvaResult');
    resultDiv.textContent = 'Testing Canva tool...';
    
    try {
        const response = await fetch('/api/test-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'canva_create_design', params: { prompt: 'Create a simple business card' } })
        });
        
        const result = await response.json();
        resultDiv.textContent = result.success ? result.output : `Error: ${result.error}`;
    } catch (error) {
        resultDiv.textContent = `Error: ${error.message}`;
    }
}

// Initialize the demo when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new RealtimeDemo();
});
