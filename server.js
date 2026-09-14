const express = require('express');
const cors = require('cors');
const { Groq } = require('groq-sdk');

const app = express();

// Bütün domenlərdən (Frontend-dən) gələn sorğulara icazə veririk
app.use(cors());
app.use(express.json());

// Sizin verdiyiniz Groq API Açarı
const groq = new Groq({
    apiKey: "Gsk_LHPCYaMCe0Ur0LpGXkOTWGdyb3FYgokha7gN8qNajlSvAxEEeCvq"
});

// Süni intellektə mesaj göndərmək üçün ana endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: "Mesaj boş ola bilməz" });
        }

        // Groq API-yə sorğu göndəririk (Sürətli LLaMA modelindən istifadə edilir)
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "Sən azərbaycan dilində kömək edən, ağıllı və peşəkar bir süni intellekt asistanısan. Bütün suallara dəqiq və aydın cavab verirsən."
                },
                {
                    role: "user",
                    content: message
                }
            ],
            model: "llama3-8b-8192", 
            temperature: 0.7,
            max_tokens: 2048,
        });

        const reply = chatCompletion.choices[0]?.message?.content || "Cavab alına bilmədi.";
        
        // Nəticəni Frontend-ə qaytarırıq
        res.json({ reply: reply });

    } catch (error) {
        console.error("API Xətası:", error);
        res.status(500).json({ error: "Serverdə xəta baş verdi. Zəhmət olmasa yenidən yoxlayın." });
    }
});

// Serverin işə düşməsi
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server uğurla işə düşdü! Port: ${PORT}`);
});
