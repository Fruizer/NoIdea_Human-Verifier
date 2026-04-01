let sessionStartTime = null;
let lastTypingTime = null;
let pauseCount = 0;
let totalPauseTime = 0;
const PAUSE_THRESHOLD = 2000;

const editor = document.getElementById('mainEditor');
const wpmDisplay = document.getElementById('wpmDisplay');
const wordCountDisplay = document.getElementById('wordCount');
const charCountDisplay = document.getElementById('charCount');
const pauseDisplay = document.getElementById('pauseDisplay');
const insertDisplay = document.getElementById('insertCount');
const deleteDisplay = document.getElementById('deleteCount');
const pasteDisplay = document.getElementById('pasteCount');
const confidenceDisplay = document.getElementById('confidenceScore');
const suggestionsList = document.getElementById('suggestionsList');
const documentTabsList = document.getElementById('documentTabsList');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const generateReportBtn = document.getElementById('generateReportBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportReportBtn = document.getElementById('exportReportBtn');
const themeToggle = document.getElementById('themeToggle');

let previousText = editor.innerText || '';
let insertedChars = 0;
let deletedChars = 0;
let pasteEvents = 0;
let largePasteEvents = 0;
let repeatedWordCount = 0;
let fillerWordCount = 0;
let runOnCount = 0;
let autoSaveTimer = null;
let drafts = [];
let activeTypingTimeMs = 0;

const fillerWords = ['really', 'basically', 'literally', 'very', 'just'];

// --- 2. Set up toolbar actions ---
document.getElementById('boldBtn').addEventListener('click', () => document.execCommand('bold'));
document.getElementById('italicBtn').addEventListener('click', () => document.execCommand('italic'));

document.getElementById('fontSelect').addEventListener('change', (e) => {
    document.execCommand('fontName', false, e.target.value);
});

document.getElementById('headerSelect').addEventListener('change', (e) => {
    const tag = e.target.value;
    document.execCommand('formatBlock', false, tag);
});

document.getElementById('sizeSelect').addEventListener('change', (e) => {
    document.execCommand('fontSize', false, e.target.value);
});

document.getElementById('alignLeftBtn').addEventListener('click', () => document.execCommand('justifyLeft'));
document.getElementById('alignCenterBtn').addEventListener('click', () => document.execCommand('justifyCenter'));
document.getElementById('alignRightBtn').addEventListener('click', () => document.execCommand('justifyRight'));

saveDraftBtn.addEventListener('click', saveDraft);
generateReportBtn.addEventListener('click', generateReport);
exportPdfBtn.addEventListener('click', () => window.print());
exportReportBtn.addEventListener('click', () => downloadReportText());

themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        themeToggle.textContent = '🌙 Dark Mode';
    } else {
        document.documentElement.dataset.theme = 'dark';
        themeToggle.textContent = '☀️ Light Mode';
    }
});

function setUpAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(saveDraft, 25000);
}

function saveDraft() {
    const html = editor.innerHTML;
    const text = editor.innerText;
    const now = new Date();
    const snapshot = {
        timestamp: now.toLocaleString(),
        html,
        text
    };
    drafts.unshift(snapshot);
    if (drafts.length > 20) drafts.pop();
    refreshDraftHistoryUI();
}

function refreshDraftHistoryUI() {
    const draftHistoryList = document.getElementById('draftHistoryList');
    draftHistoryList.innerHTML = '';
    drafts.forEach((draft, index) => {
        const item = document.createElement('div');
        item.className = 'draft-item';
        const label = document.createElement('span');
        label.textContent = `Draft ${index + 1} (${draft.timestamp})`;
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '5px';
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn-small btn-primary';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', () => {
            editor.innerHTML = draft.html;
            previousText = editor.innerText;
            updateAllMetrics();
            runSuggestionsScanner(editor.innerText);
            updateCheckpoints();
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-small btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
            drafts.splice(index, 1);
            refreshDraftHistoryUI();
        });
        buttonContainer.appendChild(restoreBtn);
        buttonContainer.appendChild(deleteBtn);
        item.appendChild(label);
        item.appendChild(buttonContainer);
        draftHistoryList.appendChild(item);
    });
}

function downloadReportText() {
    const textReport = buildReportText();
    const blob = new Blob([textReport], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'authorship_report.txt';
    link.click();
    URL.revokeObjectURL(link.href);
}

function buildReportText() {
    return `Noldea Authorship Report\n` +
        `-------------------------\n` +
        `Confidence Score: ${confidenceDisplay.innerText.replace('Confidence Score: ', '')}\n` +
        `WPM: ${wpmDisplay.innerText}\n` +
        `Words: ${wordCountDisplay.innerText}\n` +
        `Characters: ${charCountDisplay.innerText}\n` +
        `Pauses: ${pauseDisplay.innerText}\n` +
        `Insertions: ${insertDisplay.innerText}\n` +
        `Deletions: ${deleteDisplay.innerText}\n` +
        `Paste events: ${pasteEvents} (large: ${largePasteEvents})\n` +
        `Repeated words flagged: ${repeatedWordCount}\n` +
        `Filler words flagged: ${fillerWordCount}\n` +
        `Run-on sentences flagged: ${runOnCount}\n`;
}

// --- 3. Main input tracking ---
editor.addEventListener('input', () => {
    const now = Date.now();
    const text = editor.innerText;

    if (!sessionStartTime) {
        sessionStartTime = now;
        lastTypingTime = now;
    }

    // Pause tracking
    if (now - lastTypingTime > PAUSE_THRESHOLD) {
        pauseCount += 1;
        totalPauseTime += now - lastTypingTime;
    } else {
        // Only add to active typing time if not paused
        activeTypingTimeMs += now - lastTypingTime;
    }
    lastTypingTime = now;

    // Insert/Delete tracking
    const currentLength = text.length;
    const previousLength = previousText.length;
    const delta = currentLength - previousLength;
    if (delta > 0) insertedChars += delta;
    else if (delta < 0) deletedChars += Math.abs(delta);
    previousText = text;

    updateCheckpoints();
});

// --- 4. Paste Detection ---
editor.addEventListener('paste', (e) => {
    pasteEvents += 1;
    const pasteData = e.clipboardData.getData('text');
    const pasteLength = pasteData.trim().split(/\s+/).filter(w => w).length;
    if (pasteLength > 15) {
        largePasteEvents += 1;
        addSuggestion(`⚠️ <b>Large block pasted</b> (${pasteLength} words). Don't forget to add a citation!`);
    }
    updateAllMetrics();
});

function updateAllMetrics() {
    const text = editor.innerText;
    const noSpaceChars = text.replace(/\s+/g, '').length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);

    const now = Date.now();
    const elapsedMinutes = activeTypingTimeMs > 0 ? activeTypingTimeMs / 60000 : 0.001;
    const wpm = Math.round(words.length / elapsedMinutes);

    wpmDisplay.innerText = wpm;
    wordCountDisplay.innerText = words.length;
    charCountDisplay.innerText = noSpaceChars;

    const pauseSeconds = (totalPauseTime / 1000).toFixed(1);
    pauseDisplay.innerText = `${pauseCount} (${pauseSeconds}s thinking time)`;

    insertDisplay.innerText = insertedChars;
    deleteDisplay.innerText = deletedChars;
    pasteDisplay.innerText = `${pasteEvents} (large ${largePasteEvents})`;
}

function runSuggestionsScanner(fullText) {
    suggestionsList.innerHTML = '';

    repeatedWordCount = 0;
    fillerWordCount = 0;
    runOnCount = 0;
    let foundIssues = false;

    const repeatedWordRegex = /\b(\w+)\s+\1\b/ig;
    let match;
    while ((match = repeatedWordRegex.exec(fullText)) !== null) {
        repeatedWordCount += 1;
        addSuggestion(`Repeated word detected: "<b>${match[1]}</b>".`);
        foundIssues = true;
    }

    const lower = fullText.toLowerCase();
    fillerWords.forEach(word => {
        const matches = lower.match(new RegExp(`\\b${word}\\b`, 'g')) || [];
        if (matches.length > 0) {
            fillerWordCount += matches.length;
            addSuggestion(`Filler word "<b>${word}</b>" used ${matches.length} time(s).`);
            foundIssues = true;
        }
    });

    const sentences = fullText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    sentences.forEach(sentence => {
        const wordsInSentence = sentence.split(/\s+/).filter(w => w.length > 0);
        if (wordsInSentence.length > 35) {
            runOnCount += 1;
            addSuggestion(`Run-on sentence detected (${wordsInSentence.length} words).`);
            foundIssues = true;
        }
    });

    if (!foundIssues && fullText.trim().length > 0) {
        addSuggestion('Nice work! No major structural issues detected yet.');
    }

    updateAllMetrics();
}

function updateCheckpoints() {
    documentTabsList.innerHTML = '';
    const headings = editor.querySelectorAll('h1, h2, h3');
    headings.forEach((heading, index) => {
        if (!heading.id) heading.id = `heading-${Date.now()}-${index}`;
        const btn = document.createElement('button');
        btn.className = 'checkpoint-tab-btn';
        btn.textContent = `${heading.tagName} · ${heading.textContent}`;
        btn.addEventListener('click', () => {
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        documentTabsList.appendChild(btn);
    });
}

function generateReport() {
    updateAllMetrics();
    runSuggestionsScanner(editor.innerText);

    let score = 100;
    score -= pauseCount * 1.5;
    score -= largePasteEvents * 8;
    score -= repeatedWordCount * 5;
    score -= fillerWordCount * 2;
    score -= runOnCount * 3;
    score -= Math.max(0, 50 - parseInt(wpmDisplay.innerText, 10)) * 0.2;
    score = Math.max(0, Math.min(100, Math.round(score)));

    confidenceDisplay.innerText = `Confidence Score: ${score}%`;

    // Clear old colors
    confidenceDisplay.classList.remove('score-good', 'score-warning', 'score-danger');

    // Add the correct new color
    if (score >= 80) {
        confidenceDisplay.classList.add('score-good'); // Green
    } else if (score >= 50) {
        confidenceDisplay.classList.add('score-warning'); // Yellow
    } else {
        confidenceDisplay.classList.add('score-danger'); // Red
    }
}

// Helper to push text to the UI list
function addSuggestion(message) {
    const li = document.createElement('li');
    li.innerHTML = message; 
    suggestionsList.appendChild(li);
}

// --- Startup ---
setUpAutoSave();
updateAllMetrics();
updateCheckpoints();
runSuggestionsScanner(editor.innerText);
