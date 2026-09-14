const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

        if (system) {
            apiMessages.push({ role: "system", content: system });
        }

        if (messages && messages.length > 0) {
            apiMessages = apiMessages.concat(messages);
        }

        if (fileData) {
            apiMessages.push({
                role: "user",
                content: `[Yüklənmiş sənəd: ${fileData.name}, Növ: ${fileData.type}]. Zəhmət olmasa, bu sənədi/faylı nəzərə alaraq hüquqi təhlil apar, səhvləri və boşluqları göstər.`
            });
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
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
