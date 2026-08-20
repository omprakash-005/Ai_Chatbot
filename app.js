// ---------------------------------------------------------------------------
// Language <-> speech locale map (must mirror the backend's LANGUAGES dict)
// ---------------------------------------------------------------------------
const SPEECH_LOCALES = {
  en: "en-IN",
  hi: "hi-IN",
  or: "or-IN", // NOTE: Odia speech recognition/synthesis support varies a lot
              // by browser/OS. Chrome on desktop generally supports Odia
              // recognition; text-to-speech voices for Odia are rarer.
              // The code below falls back gracefully if a voice/engine
              // is unavailable.
};

const langSelect = document.getElementById("language");
let chatHistory = []; // { role: "user"|"model", text: "" }

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// Speech recognition helper (Web Speech API - browser built-in, free)
// Returns a function you can call to start listening; it fills the
// given input element and updates a status element.
// ---------------------------------------------------------------------------
function setupSpeechRecognition(micBtnId, inputId, statusId) {
  const micBtn = document.getElementById(micBtnId);
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.disabled = true;
    status.textContent = "Voice input isn't supported in this browser. Try Chrome.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;

  let listening = false;

  micBtn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }
    recognition.lang = SPEECH_LOCALES[langSelect.value] || "en-IN";
    try {
      recognition.start();
    } catch (e) {
      console.error(e);
    }
  });

  recognition.onstart = () => {
    listening = true;
    micBtn.classList.add("listening");
    status.textContent = `Listening in ${langSelect.options[langSelect.selectedIndex].text}...`;
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    input.value = transcript;
  };

  recognition.onerror = (event) => {
    status.textContent = `Mic error: ${event.error}. (Odia support depends on your browser/OS.)`;
  };

  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove("listening");
    status.textContent = "";
  };
}

setupSpeechRecognition("mic-btn", "chat-input", "mic-status");
setupSpeechRecognition("mic-btn-analyze", "analyze-question", "analyze-mic-status");
setupSpeechRecognition("mic-btn-generate", "generate-prompt", "generate-mic-status");

// ---------------------------------------------------------------------------
// Speech synthesis (text-to-speech) helper
// ---------------------------------------------------------------------------
function speak(text, langCode) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = SPEECH_LOCALES[langCode] || "en-IN";

  // Try to pick a voice that actually matches the locale; some browsers
  // ignore utter.lang if no matching voice is installed.
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang === utter.lang) ||
                voices.find((v) => v.lang.startsWith(langCode));
  if (match) utter.voice = match;

  window.speechSynthesis.cancel(); // stop any current speech first
  window.speechSynthesis.speak(utter);
}

// ---------------------------------------------------------------------------
// CHAT TAB
// ---------------------------------------------------------------------------
const chatWindow = document.getElementById("chat-window");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const speakReplies = document.getElementById("speak-replies");

function appendMessage(text, role) {
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "user" : "bot"}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  appendMessage(message, "user");
  chatHistory.push({ role: "user", text: message });
  chatInput.value = "";

  const thinkingDiv = document.createElement("div");
  thinkingDiv.className = "msg bot";
  thinkingDiv.textContent = "...";
  chatWindow.appendChild(thinkingDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        language: langSelect.value,
        history: chatHistory.slice(0, -1), // exclude the message we just sent (server appends it)
      }),
    });
    const data = await res.json();
    thinkingDiv.remove();

    if (data.error) {
      appendMessage(`⚠️ ${data.error}`, "bot");
      return;
    }

    appendMessage(data.reply, "bot");
    chatHistory.push({ role: "model", text: data.reply });

    if (speakReplies.checked) {
      speak(data.reply, langSelect.value);
    }
  } catch (err) {
    thinkingDiv.remove();
    appendMessage(`⚠️ Network error: ${err.message}`, "bot");
  }
}

sendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

// ---------------------------------------------------------------------------
// IMAGE ANALYSIS TAB
// ---------------------------------------------------------------------------
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const analyzeBtn = document.getElementById("analyze-btn");
const analyzeQuestion = document.getElementById("analyze-question");
const analyzeResult = document.getElementById("analyze-result");

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.src = e.target.result;
    imagePreview.style.display = "block";
  };
  reader.readAsDataURL(file);
});

analyzeBtn.addEventListener("click", async () => {
  const file = imageInput.files[0];
  if (!file) {
    analyzeResult.textContent = "Please choose an image first.";
    return;
  }
  analyzeResult.textContent = "Analyzing...";

  const formData = new FormData();
  formData.append("image", file);
  formData.append("question", analyzeQuestion.value.trim() || "Describe this image in detail.");
  formData.append("language", langSelect.value);

  try {
    const res = await fetch("/api/analyze-image", { method: "POST", body: formData });
    const data = await res.json();
    if (data.error) {
      analyzeResult.textContent = `⚠️ ${data.error}`;
      return;
    }
    analyzeResult.textContent = data.reply;
    speak(data.reply, langSelect.value);
  } catch (err) {
    analyzeResult.textContent = `⚠️ Network error: ${err.message}`;
  }
});

// ---------------------------------------------------------------------------
// IMAGE GENERATION TAB
// ---------------------------------------------------------------------------
const generateBtn = document.getElementById("generate-btn");
const generatePrompt = document.getElementById("generate-prompt");
const generateResult = document.getElementById("generate-result");

generateBtn.addEventListener("click", async () => {
  const prompt = generatePrompt.value.trim();
  if (!prompt) {
    generateResult.textContent = "Please enter a description first.";
    return;
  }
  generateResult.textContent = "Generating image...";

  try {
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, language: langSelect.value }),
    });
    const data = await res.json();
    if (data.error) {
      generateResult.textContent = `⚠️ ${data.error}`;
      return;
    }
    generateResult.innerHTML = "";
    if (data.caption) {
      const p = document.createElement("p");
      p.textContent = data.caption;
      generateResult.appendChild(p);
      speak(data.caption, langSelect.value);
    }
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${data.image_base64}`;
    generateResult.appendChild(img);
  } catch (err) {
    generateResult.textContent = `⚠️ Network error: ${err.message}`;
  }
});

// Warm up the voices list (Chrome loads it async)
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
