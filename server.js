const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// 413 Payload Too Large xətasının qarşısını alan limit parametrləri
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Sənin təqdim etdiyin Groq API Açarı
const API_KEY = "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"; 

app.post('/', async (req, res) => {
    try {
        const { system, messages, fileData } = req.body;

        if (!messages && !fileData) {
            return res.status(400).json({
                content: [{ text: "Xəta: Mesaj və ya sənəd tapılmadı." }]
            });
        }

        let apiMessages = [];

        // 1. Sistemin hüquqşünas rolunu (system prompt) əlavə edirik
        if (system) {
            apiMessages.push({ role: "system", content: system });
        }

        // 2. Əgər istifadəçi sənəd/şəkil yükləyibsə
        if (fileData) {
            apiMessages.push({
                role: "user",
                content: [
                    { 
                        type: "text", 
                        text: "Zəhmət olmasa, bu sənədi hüquqi baxımdan analiz et, səhvləri, boşluqları aşkarla və düzəldilmiş variantını təqdim et." 
                    },
                    {
                        type: "image_url",
                        image_url: {
                            // Frontend-dən gələn Base64 formatlı şəkli Groq-a ötürürük
                            url: `data:${fileData.type};base64,${fileData.base64}`
                        }
                    }
                ]
            });
        } 
        // 3. Əgər sadəcə söhbət (Chat) panelidirsə
        else if (messages && messages.length > 0) {
            apiMessages = apiMessages.concat(messages);
        }

        // Groq API-yə qoşulma sorğusu
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "llama-3.2-11b-vision-preview", // Groq-un şəkil və mətn oxuyan modeli
                messages: apiMessages,
                temperature: 0.5 
            })
        });

        const data = await response.json();

        // API tərəfindən hər hansı xəta gələrsə
        if (!response.ok) {
            console.error("API Xətası:", data);
            return res.status(500).json({
                content: [{ text: `Süni intellekt xətası: ${data.error?.message || 'Bilinməyən xəta'}` }]
            });
        }

        // AI-dan gələn real cavabı alırıq
        const aiResponseText = data.choices[0].message.content;

        // Frontend-in tam gözlədiyi formatda geri qaytarırıq
        return res.json({
            content: [{ text: aiResponseText }]
        });

    } catch (error) {
        console.error("Server daxili xətası:", error);
        return res.status(500).json({
            content: [{ text: "Backend server xətası: " + error.message }]
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server uğurla işə salındı! Port: ${PORT}`);
});
