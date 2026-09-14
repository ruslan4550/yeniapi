const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS və 50MB-a qədər böyük faylları (Base64) qəbul etmək üçün
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Sənin qeyd etdiyin OpenRouter API Key və Pulsuz Model
const OPENROUTER_API_KEY = "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";
const AI_MODEL = "google/gemini-2.0-flash-lite-preview-02-05:free"; // 100% pulsuz və sürətli model

// 1. Söhbət End-pointi (Standart/Pulsuz paket üçün)
app.post('/api/chat', async (req, res) => {
    try {
        const { system, messages, plan } = req.body;
        
        const formattedMessages = [
            { role: "system", content: system },
            ...messages
        ];

        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: AI_MODEL,
            messages: formattedMessages
        }, {
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        res.json({ content: [{ text: response.data.choices[0].message.content }] });
    } catch (error) {
        console.error("Chat API Xətası:", error.response ? error.response.data : error.message);
        res.status(500).json({ content: [{ text: "Sistemlə əlaqə qurularkən xəta baş verdi. Zəhmət olmasa yenidən cəhd edin." }] });
    }
});

// 2. Sənəd Analizi End-pointi (Yalnız Premium və Biznes)
app.post('/api/analyze', async (req, res) => {
    try {
        const { messages, plan, fileData } = req.body;

        // Pulsuz planın bu xidmətdən istifadəsinin qarşısını alırıq
        if (plan === "Pulsuz") {
            return res.json({ content: [{ text: "Sənəd analizi yalnız Premium və Biznes paketlərində mövcuddur. Zəhmət olmasa paketinizi yüksəldin." }] });
        }

        // Xüsusi Prompt: Riskləri tapmaq və düzəldilmiş versiyanı təqdim etmək
        const systemPrompt = `Sən yüksək ixtisaslı, peşəkar hüquqşünas və sənəd analizatorusan. 
İstifadəçinin göndərdiyi müqaviləni və ya sənədi tam analiz et.
1. Sənəddəki BÜTÜN HÜQUQİ RİSKLƏRİ və istifadəçi üçün zərərli ola biləcək bəndləri aşkarla.
2. Həmin riskli bəndləri DÜZƏLDƏRƏK tamamilə risksiz, istifadəçinin xeyrinə olan yeni, təhlükəsiz versiyasını mütləq təqdim et.
Cavabını Markdown formatında, səliqəli və aydın strukturla ver.`;

        let contentArray = [];
        
        // Şəkil faylıdırsa (JPG/PNG) Base64 olaraq OpenRouter-ə göndəririk
        if (fileData && fileData.type.startsWith('image/')) {
            contentArray.push({
                type: "image_url",
                image_url: { url: `data:${fileData.type};base64,${fileData.base64}` }
            });
            contentArray.push({ type: "text", text: messages[0]?.content || "Bu sənədi hüquqi baxımdan analiz et." });
        } else if (fileData) {
            // PDF, DOCX kimi sənədlər üçün məzmun xəbərdarlığı
            contentArray.push({ 
                type: "text", 
                text: `Sənəd yükləndi: ${fileData.name}. Bu sənədin məzmununu aşağıdakı tələblərə əsasən analiz et:\n${messages[0]?.content || "Sənədi analiz et və riskləri tap."}` 
            });
        }

        const formattedMessages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: contentArray }
        ];

        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: AI_MODEL,
            messages: formattedMessages
        }, {
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        res.json({ content: [{ text: response.data.choices[0].message.content }] });
    } catch (error) {
        console.error("Analyze API Xətası:", error.response ? error.response.data : error.message);
        res.status(500).json({ content: [{ text: "Analiz zamanı xəta baş verdi. Fayl formatını yoxlayın və ya təkrar cəhd edin." }] });
    }
});

app.listen(PORT, () => console.log(`API Server is running on port ${PORT}`));
