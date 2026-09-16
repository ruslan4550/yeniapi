const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ================== CORS + Body limiti ==================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.sendStatus(200);
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ================== GROQ AYARLARI ==================
// GROQ API açarı Render-də Environment Variable kimi oxunur
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_CHAT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || "llama-3.2-11b-vision-preview";

console.log("=========================================");
console.log("GROQ_API_KEY təyin olunub:", !!GROQ_API_KEY);
if (GROQ_API_KEY) {
  console.log("GROQ_API_KEY prefix:", GROQ_API_KEY.slice(0, 8) + "...");
}
console.log("=========================================");

// ================== DİL TƏLİMATI ==================
function getLanguageInstruction(lang) {
  switch (lang) {
    case 'ru':
      return "ОБЯЗАТЕЛЬНО ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. Используй профессиональный юридический язык применительно к законодательству Азербайджанской Республики.";
    case 'en':
      return "YOU MUST RESPOND STRICTLY IN ENGLISH. Use professional legal terminology regarding the legislation of the Republic of Azerbaijan.";
    case 'az':
    default:
      return "MÜTLƏQ YALNIZ AZƏRBAYCAN DİLİNDƏ CAVAB VER. Azərbaycan Respublikasının qanunvericiliyinə uyğun peşəkar hüquqi terminologiyadan istifadə et.";
  }
}

// ================== GROQ CHAT (Fallback dəstəyi ilə) ==================
async function callGroqChat(messages, systemPrompt) {
  if (!GROQ_API_KEY || !GROQ_API_KEY.startsWith("gsk_")) {
    throw new Error("GROQ_API_KEY təyin olunmayıb. Render → Environment bölməsinə əlavə edin.");
  }

  const formatted = [
    { role: "system", content: systemPrompt },
    ...messages
  ];

  const modelsToTry = [GROQ_CHAT_MODEL, "llama-3.1-8b-instant", "llama3-70b-8192"];

  for (const model of modelsToTry) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: model,
          messages: formatted,
          temperature: 0.2,
          max_tokens: 4096
        },
        {
          headers: {
            "Authorization": `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 45000
        }
      );

      const choice = response.data?.choices?.[0]?.message?.content;
      if (choice) return choice;
    } catch (err) {
      console.warn(`Model ${model} xətası, növbəti model yoxlanılır...`, err.message);
      if (model === modelsToTry[modelsToTry.length - 1]) {
        throw new Error("Groq API xətası: " + (err.response?.data?.error?.message || err.message));
      }
    }
  }
}

// ================== GROQ VISION (Şəkillər üçün) ==================
async function callGroqVision(systemPrompt, userText, imageDataUrl) {
  if (!GROQ_API_KEY || !GROQ_API_KEY.startsWith("gsk_")) {
    throw new Error("GROQ_API_KEY təyin olunmayıb.");
  }

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 4096
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 90000
      }
    );

    const choice = response.data?.choices?.[0]?.message?.content;
    if (!choice) throw new Error("Groq Vision boş cavab qaytardı");
    return choice;
  } catch (err) {
    console.error("Groq Vision xətası:", err.message);
    throw new Error("Groq Vision xətası: " + (err.response?.data?.error?.message || err.message));
  }
}

// ================== FAYLDAN MƏTN ÇIXARMA ==================
async function extractTextFromFile(fileData) {
  if (!fileData || !fileData.base64) return null;

  const buffer = Buffer.from(fileData.base64, 'base64');
  const type = (fileData.type || '').toLowerCase();
  const name = (fileData.name || '').toLowerCase();

  try {
    // PDF
    if (type.includes('pdf') || name.endsWith('.pdf')) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        if (data && data.text) return data.text;
      } catch (e) {
        console.warn("pdf-parse uğursuz oldu, UTF-8 kimi dənənir");
      }
      return buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, '');
    }
    // DOCX
    if (type.includes('wordprocessingml') || type.includes('officedocument') || name.endsWith('.docx')) {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        if (result && result.value) return result.value;
      } catch (e) {
        console.warn("mammoth xətası");
      }
    }
    // XLSX
    if (type.includes('spreadsheetml') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.read(buffer, { type: 'buffer' });
        let text = '';
        wb.SheetNames.forEach(sn => {
          text += `\n--- Sheet: ${sn} ---\n`;
          text += XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
        });
        return text;
      } catch (e) {
        console.warn("xlsx xətası");
      }
    }
    // TXT və digər mətnlər
    return buffer.toString('utf-8');
  } catch (e) {
    console.error("Fayl emalı xətası:", e.message);
  }
  return null;
}

// ================== 1. CHAT ENDPOINT ==================
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages, plan, lang } = req.body;

    const langInstr = getLanguageInstruction(lang || 'az');
    const baseSystem = system || "Sən Normisera hüquqi süni intellekt köməkçisisən.";
    const fullSystemPrompt = `${baseSystem}\n\n[DİL TƏLƏBİ]: ${langInstr}`;

    const validMessages = Array.isArray(messages)
      ? messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      : [];

    const answerText = await callGroqChat(validMessages, fullSystemPrompt);
    res.json({ content: [{ text: answerText }] });
  } catch (error) {
    console.error("Chat API xətası:", error.message);
    res.status(500).json({ content: [{ text: "Xəta: " + error.message }] });
  }
});

// ================== 2. SƏNƏD ANALİZİ ENDPOINT ==================
app.post('/api/analyze', async (req, res) => {
  try {
    const { messages, plan, fileData, lang } = req.body;

    if (plan === "Pulsuz") {
      return res.json({
        content: [{
          text: "Sənəd analizi funksiyası yalnız Premium və Biznes paketlərində mövcuddur. Zəhmət olmasa paketinizi yeniləyin."
        }]
      });
    }

    if (!fileData || !fileData.base64) {
      return res.json({
        content: [{ text: "Sənəd tapılmadı. Zəhmət olmasa fayl yükləyin." }]
      });
    }

    const langInstr = getLanguageInstruction(lang || 'az');

    const systemPrompt = `Sən yüksək ixtisaslı, peşəkar hüquqşünas və sənəd analitikisən.
Təqdim olunan sənədi dərindən təhlil et.

CAVABINI MÜTLƏQ AŞAĞIDAKI DƏQİQ STRUKTURDA TƏQDİM ET:

### ⚠️ HÜQUQİ RİSKLƏR VƏ ZƏRƏRLİ BƏNDLƏR
- Sənəddə istifadəçi üçün riskli, birtərəfli, ağır cərimə yaradan və hüquqları məhdudlaşdıran maddələri aydın göstər.

--- DÜZƏLDİLMİŞ RİSKSIZ SƏNƏD ---

### 🛡️ DÜZƏLDİLMİŞ VƏ RİSKSİZ SƏNƏD MƏTNİ
- Bütün riskli bəndləri sil və istifadəçinin xeyrinə tam hüquqi təhlükəsiz maddələrlə əvəzlə.
- Risksiz sənədi tam, istifadəyə və yükləməyə hazır şəkildə tərtib et.

[DİL TƏLƏBİ]: ${langInstr}`;

    const fileType = (fileData.type || '').toLowerCase();
    const isImage = fileType.startsWith('image/');

    let answerText;

    if (isImage) {
      const dataUrl = `data:${fileData.type};base64,${fileData.base64}`;
      const userText = (messages && messages[0]?.content) || "Bu sənədi analiz et: riskləri göstər və düzəldilmiş risksiz versiyanı çıxar.";
      answerText = await callGroqVision(systemPrompt, userText, dataUrl);
    } else {
      const extracted = await extractTextFromFile(fileData);

      if (!extracted || extracted.trim().length < 5) {
        return res.json({
          content: [{
            text: "Sənəddən mətn oxuna bilmədi. Zəhmət olmasa aydın şəkil (JPG/PNG) və ya PDF/DOCX yükləyin."
          }]
        });
      }

      const trimmed = extracted.slice(0, 15000);
      const userContent = `Aşağıdakı sənədi analiz et, riskli bəndləri göstər və düzəldilmiş risksiz müqaviləni təqdim et:\n\n--- SƏNƏD BAŞLANĞICI ---\n${trimmed}\n--- SƏNƏD SONU ---`;

      answerText = await callGroqChat(
        [{ role: 'user', content: userContent }],
        systemPrompt
      );
    }

    res.json({ content: [{ text: answerText }] });
  } catch (error) {
    console.error("Analyze API xətası:", error.message);
    res.status(500).json({
      content: [{ text: "Sənəd analizi zamanı xəta baş verdi: " + error.message }]
    });
  }
});

// ================== 3. TTS (Text-to-Speech) ==================
app.get('/api/tts', async (req, res) => {
  try {
    const text = (req.query.text || '').toString();
    const lang = (req.query.lang || 'az').toString();

    if (!text) return res.status(400).send("Mətn tələb olunur");

    const langMap = { az: 'az', ru: 'ru', en: 'en' };
    const tl = langMap[lang] || 'az';

    const clean = text
      .replace(/<[^>]*>?/gm, '')
      .replace(/[*_#`~]/g, '')
      .slice(0, 300);

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(clean)}&tl=${tl}&client=tw-ob`;

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://translate.google.com/'
      },
      timeout: 20000
    });

    res.set('Content-Type', 'audio/mpeg');
    response.data.pipe(res);
  } catch (error) {
    console.error("TTS xətası:", error.message);
    res.status(500).send("Səs yaradılarkən xəta baş verdi");
  }
});

// ================== SAĞLAMLIQ YOXLAMASI ==================
app.get('/', (req, res) => {
  res.send("Normisera Backend API işləyir ✅");
});

app.get('/health', (req, res) => {
  const keyValid = !!GROQ_API_KEY && GROQ_API_KEY.startsWith("gsk_");
  res.json({
    ok: true,
    groqKeySet: keyValid,
    keyPrefix: GROQ_API_KEY ? GROQ_API_KEY.slice(0, 8) + "..." : "yoxdur"
  });
});

app.listen(PORT, () => console.log(`✅ API Server portda işləyir: ${PORT}`));
