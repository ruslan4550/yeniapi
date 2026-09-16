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
// Açar Render-də Environment Variable kimi təyin olunur: GROQ_API_KEY
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_CHAT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";

// Başlanğıc yoxlaması
console.log("=========================================");
console.log("GROQ_API_KEY təyin olunub:", !!GROQ_API_KEY);
console.log("GROQ_API_KEY uzunluq:", GROQ_API_KEY.length);
console.log("GROQ_API_KEY prefix:", GROQ_API_KEY.slice(0, 8) + "...");
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

// ================== GROQ CHAT ==================
async function callGroqChat(messages, systemPrompt) {
  if (!GROQ_API_KEY || !GROQ_API_KEY.startsWith("gsk_")) {
    throw new Error("GROQ_API_KEY təyin olunmayıb. Render → Environment bölməsinə əlavə edin.");
  }

  const formatted = [
    { role: "system", content: systemPrompt },
    ...messages
  ];

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_CHAT_MODEL,
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
    if (!choice) throw new Error("Groq boş cavab qaytardı");
    return choice;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    console.error("Groq xətası | status:", status, "| detail:", JSON.stringify(detail));

    if (status === 401) {
      throw new Error("Groq API açarı etibarsızdır (401). Render-də GROQ_API_KEY-i yeniləyin.");
    }
    if (status === 429) {
      throw new Error("Groq limiti aşıldı (429). Bir az sonra yenidən cəhd edin.");
    }
    if (detail?.error?.message) {
      throw new Error("Groq: " + detail.error.message);
    }
    throw new Error("Groq xətası: " + (err.message || "Bilinməyən"));
  }
}

// ================== GROQ VISION (şəkillər) ==================
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
    const status = err.response?.status;
    const detail = err.response?.data;
    console.error("Groq Vision xətası | status:", status, "| detail:", JSON.stringify(detail));

    if (status === 401) throw new Error("Groq API açarı etibarsızdır (401).");
    if (detail?.error?.message) throw new Error("Groq Vision: " + detail.error.message);
    throw new Error("Groq Vision xətası: " + (err.message || "Bilinməyən"));
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
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return data.text || '';
    }
    // DOCX
    if (
      type.includes('wordprocessingml') ||
      type.includes('officedocument') ||
      name.endsWith('.docx')
    ) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
    // XLSX
    if (
      type.includes('spreadsheetml') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls')
    ) {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      let text = '';
      wb.SheetNames.forEach(sn => {
        text += `\n--- Sheet: ${sn} ---\n`;
        text += XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
      });
      return text;
    }
    // TXT
    if (type.includes('text/plain') || name.endsWith('.txt')) {
      return buffer.toString('utf-8');
    }
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
    res.status(500).json({
      content: [{ text: "Xəta: " + error.message }]
    });
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
Təqdim olunan sənədi və ya müqavilə mətnini dərindən təhlil et.

CAVABIN MÜTLƏQ AŞAĞIDAKI STRUKTURDA OLSUN:

1. ⚠️ HÜQUQİ RİSKLƏR VƏ ZƏRƏRLİ BƏNDLƏR
   - Sənəddə istifadəçi üçün riskli, birtərəfli, cərimə yükü yaradan və ya hüquqları məhdudlaşdıran BÜTÜN maddələri bənd-bənd göstər və izah et.

2. 🛡️ DÜZƏLDİLMİŞ VƏ RİSKSİZ MÜQAVİLƏ (TAM SƏNƏD MƏTNİ)
   - Sənədi tamamilə yenidən tərtib et.
   - Bütün riskli bəndləri sil və ya istifadəçinin xeyrinə, tam hüquqi təhlükəsiz variantla əvəz et.
   - Düzəldilmiş risksiz müqavilə mətnini İSTİFADƏYƏ HAZIR ŞƏKİLDƏ (tam müqavilə formasında) təqdim et.

[DİL TƏLƏBİ]: ${langInstr}`;

    const fileType = (fileData.type || '').toLowerCase();
    const isImage = fileType.startsWith('image/');

    let answerText;

    if (isImage) {
      const dataUrl = `data:${fileData.type};base64,${fileData.base64}`;
      const userText =
        (messages && messages[0]?.content) ||
        "Bu sənədi analiz et: riskləri göstər və düzəldilmiş risksiz versiyanı çıxar.";
      answerText = await callGroqVision(systemPrompt, userText, dataUrl);
    } else {
      const extracted = await extractTextFromFile(fileData);

      if (!extracted || extracted.trim().length < 10) {
        return res.json({
          content: [{
            text: "Sənəddən mətn oxuna bilmədi. Zəhmət olmasa aydın şəkil (JPG/PNG) və ya mətn əsaslı PDF yükləyin."
          }]
        });
      }

      const trimmed = extracted.slice(0, 15000);

      const userContent = `Aşağıdakı sənədi hüquqi baxımdan tam analiz et, riskli bəndləri göstər və düzəldilmiş risksiz müqaviləni tam şəkildə təqdim et:\n\n--- SƏNƏD BAŞLANĞICI ---\n${trimmed}\n--- SƏNƏD SONU ---`;

      answerText = await callGroqChat(
        [{ role: 'user', content: userContent }],
        systemPrompt
      );
    }

    res.json({ content: [{ text: answerText }] });
  } catch (error) {
    console.error("Analyze API xətası:", error.message);
    res.status(500).json({
      content: [{
        text: "Sənəd analizi zamanı xəta baş verdi: " + error.message
      }]
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
      .slice(0, 200);

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(clean)}&tl=${tl}&client=tw-ob`;

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
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

// ================== Sağlamlıq yoxlaması ==================
app.get('/', (req, res) => {
  res.send("Normisera Backend API işləyir ✅");
});

app.get('/health', (req, res) => {
  const keyValid = !!GROQ_API_KEY && GROQ_API_KEY.startsWith("gsk_") && GROQ_API_KEY.length > 20;
  res.json({
    ok: true,
    groqKeySet: keyValid,
    keyLength: GROQ_API_KEY.length,
    keyPrefix: GROQ_API_KEY ? GROQ_API_KEY.slice(0, 8) + "..." : "yoxdur"
  });
});

app.listen(PORT, () => console.log(`✅ API Server portda işləyir: ${PORT}`));