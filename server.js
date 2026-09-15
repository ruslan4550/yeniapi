const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS və 50MB-a qədər böyük faylları (Base64) qəbul etmək üçün
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Groq API və OpenRouter Mənbələri
const GROQ_API_KEY = process.env.GROQ_API_KEY || "gsk_free_key_placeholder";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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";

// Groq ultra-sürətli pulsuz modeli
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const OPENROUTER_MODEL = "google/gemini-2.0-flash-lite-preview-02-05:free";

// Dili təyin edən köməkçi təlimat funksiyası
function getLanguageInstruction(lang) {
    switch (lang) {
        case 'ru':
            return "ОБЯЗАТЕЛЬНО ОТВЕЧАЙ НА РУССКОМ ЯЗЫКЕ. Используй профессиональный юридический язык Российской Федерации/Азербайджана на русском языке.";
        case 'en':
            return "YOU MUST RESPOND STRICTLY IN ENGLISH. Use professional legal terminology in English.";
        case 'az':
        default:
            return "MÜTLƏQ AZƏRBAYCAN DİLİNDƏ CAVAB VER. Azərbaycan Respublikasının qanunvericiliyinə uyğun peşəkar hüquqi terminologiyadan istifadə et.";
    }
}

// AI ilə əlaqə yaradan vahid funksiya (Groq API öncəlikli, xəta halında OpenRouter fallback)
async function getAICompletion(messages, systemPrompt) {
    const formattedMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

    // 1. Birinci Groq API-ni yoxlayırıq (Ultra-sürətli)
    if (process.env.GROQ_API_KEY || GROQ_API_KEY.startsWith("gsk_")) {
        try {
            const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: GROQ_MODEL,
                messages: formattedMessages,
                temperature: 0.2,
                max_tokens: 4096
            }, {
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 30000
            });

            if (response.data && response.data.choices && response.data.choices[0]) {
                return response.data.choices[0].message.content;
            }
        } catch (groqErr) {
            console.warn("Groq API Xətası (OpenRouter-ə yönləndirilir):", groqErr.response ? groqErr.response.data : groqErr.message);
        }
    }

    // 2. Groq cavab vermədikdə və ya Key olmadıqda OpenRouter Fallback
    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: OPENROUTER_MODEL,
            messages: formattedMessages
        }, {
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            timeout: 30000
        });

        if (response.data && response.data.choices && response.data.choices[0]) {
            return response.data.choices[0].message.content;
        }
    } catch (orErr) {
        console.error("OpenRouter API Xətası:", orErr.response ? orErr.response.data : orErr.message);
        throw new Error("AI xidmətindən cavab almaq mümkün olmadı.");
    }

    throw new Error("AI xidməti gözlənilməz cavab qaytardı.");
}

// 1. Söhbət End-pointi (Pulsuz, Premium, Biznes üçün)
app.post('/api/chat', async (req, res) => {
    try {
        const { system, messages, plan, lang } = req.body;

        const langInstruction = getLanguageInstruction(lang || 'az');
        const defaultSystem = system || "Sən Normisera hüquqi süni intellekt köməkçisisən.";
        const fullSystemPrompt = `${defaultSystem}\n\n[DİL TƏLƏBİ]: ${langInstruction}`;

        const validMessages = Array.isArray(messages) ? messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        })) : [];

        const answerText = await getAICompletion(validMessages, fullSystemPrompt);

        res.json({ content: [{ text: answerText }] });
    } catch (error) {
        console.error("Chat API Xətası:", error.message);
        res.status(500).json({ 
            content: [{ text: "Sistemlə əlaqə qurularkən xəta baş verdi. Zəhmət olmasa bir az sonra təkrar cəhd edin." }] 
        });
    }
});

// 2. Sənəd Analizi End-pointi (Yalnız Premium və Biznes paketləri üçün)
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

        const langInstruction = getLanguageInstruction(lang || 'az');

        // Xüsusi Prompt: Riskləri aşkar etmək və DÜZƏLDİLMİŞ risksiz müqavilə/sənədi çıxarmaq
        const systemPrompt = `Sən yüksək ixtisaslı, peşəkar hüquqşünas və sənəd analitikisən.
Təqdim olunan sənədi və ya müqavilə mətnini dərindən təhlil et.

CAVABIN STRUKTURU VƏ BÖLMƏLƏRİ:
1. ⚠️ **HÜQUQİ RİSKLƏR VƏ ZƏRƏRLİ BƏNDLƏR**:
   - Sənəddə istifadəçi üçün riskli, birtərəfli, cərimə yükü yaradan və ya hüquqları məhdudlaşdıran BÜTÜN maddələri bənd-bənd göstər və izah et.

2. 🛡️ **DÜZƏLDİLMİŞ VƏ RİSKSIZ MÜQAVİLƏ (SƏNƏD MƏTNİ)**:
   - Sənədi tamamilə yenidən tərtib et.
   - Bütün riskli bəndləri sil və ya istifadəçinin xeyrinə, tam hüquqi təhlükəsiz variantla əvəz et.
   - Düzəldilmiş risksiz müqavilə mətnini İSTİFADƏYƏ HAZIR ŞƏKİLDƏ (müqavilə forması kimi) tam təqdim et.

[DİL TƏLƏBİ]: ${langInstruction}`;

        let userPromptText = "";
        if (messages && messages.length > 0) {
            userPromptText = messages[messages.length - 1].content || "";
        }

        if (fileData) {
            userPromptText = `[YÜKLƏNƏN FAYL ADI]: ${fileData.name}\n[FAYL MƏZMUNU/BƏYAN]: ${fileData.text || "Fayl göndərildi"}\n\nİstifadəçi sorğusu: ${userPromptText || "Sənədi analiz et, riskləri tap və düzəldilmiş risksiz müqaviləni çıxar."}`;
        }

        const formattedMessages = [
            { role: "user", content: userPromptText }
        ];

        const answerText = await getAICompletion(formattedMessages, systemPrompt);

        res.json({ content: [{ text: answerText }] });
    } catch (error) {
        console.error("Analyze API Xətası:", error.message);
        res.status(500).json({ 
            content: [{ text: "Sənəd analizi zamanı xəta baş verdi. Fayl formatını yoxlayın və ya yenidən cəhd edin." }] 
        });
    }
});

// 3. Text-to-Speech (TTS) End-pointi (Səsli oxuma üçün)
app.get('/api/tts', async (req, res) => {
    try {
        const text = req.query.text;
        const lang = req.query.lang || 'az';

        if (!text) {
            return res.status(400).send("Mətn parametri tələb olunur");
        }

        const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/[*_#`~]/g, '').slice(0, 300);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${lang}&client=tw-ob`;

        const response = await axios.get(ttsUrl, { responseType: 'stream' });
        res.set('Content-Type', 'audio/mpeg');
        response.data.pipe(res);
    } catch (error) {
        console.error("TTS Xətası:", error.message);
        res.status(500).send("Səs yaradılarkən xəta baş verdi");
    }
});

app.get('/', (req, res) => {
    res.send("Normisera Backend API Server is running smoothly!");
});

app.listen(PORT, () => console.log(`API Server is running on port ${PORT}`));
