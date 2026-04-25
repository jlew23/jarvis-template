const CIRCUMFERENCE = 565.48; // 2 * pi * 90
const progressCircle = document.getElementById('progress-circle');
const percentageText = document.getElementById('percentage-text');
const tokensUsedEl = document.getElementById('tokens-used');
const tokensLimitEl = document.getElementById('tokens-limit');
const warningBanner = document.getElementById('warning-banner');
const glassPanel = document.querySelector('.glass-panel');

// Tabs logic
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// Voice Logic
let voiceEnabled = true;
let lastMessageHash = null;
const voiceToggleBtn = document.getElementById('voice-toggle');

voiceToggleBtn.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    if (voiceEnabled) {
        voiceToggleBtn.textContent = '🎙️ VOICE: ON';
        voiceToggleBtn.classList.remove('muted');
        speakText("Voice interface online.");
    } else {
        voiceToggleBtn.textContent = '🔇 VOICE: OFF';
        voiceToggleBtn.classList.add('muted');
        window.speechSynthesis.cancel();
    }
});

function speakText(text) {
    if (!voiceEnabled || !text || text.trim() === "") return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Try to find a British voice
    const voices = window.speechSynthesis.getVoices();
    const britishVoice = voices.find(voice => voice.lang === 'en-GB' || voice.name.includes('British') || voice.name.includes('UK'));
    if (britishVoice) {
        utterance.voice = britishVoice;
    }
    
    // JARVIS tone: slightly faster, deeper pitch if male voice, or standard British
    utterance.rate = 1.05;
    utterance.pitch = 0.9;
    
    window.speechSynthesis.speak(utterance);
}

// Load voices async to ensure they are available
window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
};

function updateDashboard(data) {
    const { used, limit, percentage } = data;
    
    percentageText.textContent = `${Math.round(percentage)}%`;
    tokensUsedEl.textContent = used.toLocaleString();
    tokensLimitEl.textContent = limit.toLocaleString();

    const dashOffset = (percentage / 100) * CIRCUMFERENCE;
    progressCircle.setAttribute('stroke-dasharray', `${dashOffset}, ${CIRCUMFERENCE}`);

    if (percentage >= 90) {
        glassPanel.classList.remove('state-warning');
        glassPanel.classList.add('state-critical');
        warningBanner.classList.remove('hidden');
    } else if (percentage >= 75) {
        glassPanel.classList.remove('state-critical');
        glassPanel.classList.add('state-warning');
        warningBanner.classList.add('hidden');
    } else {
        glassPanel.classList.remove('state-warning', 'state-critical');
        warningBanner.classList.add('hidden');
    }
}

async function fetchTokens() {
    try {
        const response = await fetch('/api/tokens');
        if (response.ok) {
            const data = await response.json();
            updateDashboard(data);
        }
    } catch (error) {
        // console.error("Failed to fetch token data:", error);
    }
}

async function fetchLatestMessage() {
    try {
        const response = await fetch('/api/latest_message');
        if (response.ok) {
            const data = await response.json();
            // If hash changed, and it's not the very first load
            if (lastMessageHash !== null && data.hash !== lastMessageHash && data.text) {
                speakText(data.text);
            }
            lastMessageHash = data.hash;
        }
    } catch (error) {
        // console.error("Failed to fetch latest message:", error);
    }
}

const logOutput = document.getElementById('log-output');
let isUserScrollingLog = false;

if (logOutput) {
    logOutput.addEventListener('scroll', () => {
        const isAtBottom = logOutput.scrollHeight - logOutput.scrollTop <= logOutput.clientHeight + 10;
        isUserScrollingLog = !isAtBottom;
    });
}

async function fetchLog() {
    if (!logOutput) return;
    try {
        const response = await fetch('/api/log');
        if (response.ok) {
            const data = await response.json();
            logOutput.textContent = data.log;
            
            if (!isUserScrollingLog) {
                logOutput.scrollTop = logOutput.scrollHeight;
            }
        }
    } catch (error) {}
}

// Fetch loop
setInterval(() => {
    fetchTokens();
    fetchLatestMessage();
    fetchLog();
}, 2000);

// Initial fetch
fetchTokens();
fetchLog();
// Wait 1 second before first message fetch so we don't speak old history on load
setTimeout(fetchLatestMessage, 1000);
