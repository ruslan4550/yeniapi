const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Bütün domenlərdən (frontend-dən) gələn sorğulara icazə
app.use(cors());

// 413 Payload Too Large xətasının həlli üçün limit 50MB təyin edilir
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Sənin verdiyin Groq API Açarı
const API_KEY = "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"; 

// 404 xətasını həll edən əsas (root) POST marşrutu
app.post('/', async (req, res) => {
    try {
        const { system, messages, fileData } = req.body;

        if (!messages && !fileData) {
            return res.status(400).json({
                content: [{ text: "Xəta: Mesaj və ya sənəd tapılmadı." }]
            });
        }

        let apiMessages = [];
        let selectedModel = "llama-3.3-70b-versatile"; // Standart mətn modeli

        if (system) {
            apiMessages.push({ role: "system", content: system });
        }

        if (fileData) {
            // Sənəd və ya şəkil olduqda Vision modeli aktivləşir
            selectedModel = "llama-3.2-11b-vision-instruct";
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
                            url: `data:${fileData.type};base64,${fileData.base64}`
                        }
                    }
                ]
            });
        } else if (messages && messages.length > 0) {
            apiMessages = apiMessages.concat(messages);
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: apiMessages,
                temperature: 0.5
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("API Xətası:", data);
            return res.status(500).json({
                content: [{ text: `Süni intellekt xətası: ${data.error?.message || 'Bilinməyən xəta'}` }]
            });
        }

        const aiResponseText = data.choices[0].message.content;

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
