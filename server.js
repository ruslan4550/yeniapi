const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. CORS - Bütün kənar (frontend) sorğulara icazə verir
app.use(cors());

// 2. 413 XƏTASININ HƏLLİ: Sənəd/Şəkil yüklənməsi üçün limiti 50MB edirik
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 3. 404 XƏTASININ HƏLLİ: Frontend-in sorğu göndərdiyi ana (root) POST marşrutu
app.post('/', async (req, res) => {
    try {
        const { system, messages, plan, fileData } = req.body;

        // Əgər gələn sorğuda heç nə yoxdursa, geri qaytar (Təhlükəsizlik üçün)
        if (!messages && !fileData) {
            return res.status(400).json({
                content: [{ text: "Xəta: Mesaj və ya sənəd tapılmadı." }]
            });
        }

        // Konsolda sorğunu izləmək üçün
        console.log(`[Yeni Sorğu] Plan: ${plan || 'Bilinmir'}`);
        if (fileData) {
            console.log(`[Sənəd] Adı: ${fileData.name}, Formatı: ${fileData.type}`);
        }

        // =====================================================================
        // SÜNİ İNTELLEKT (API) KODU BURAYA YAZILMALIDIR (OpenAI, Gemini, vb.)
        // =====================================================================
        
        let aiResponseText = "";

        if (fileData) {
            // Sənəd analizi üçün müvəqqəti cavab (Siz bura AI kodunuzu qoyacaqsınız)
            aiResponseText = `"${fileData.name}" adlı sənəd serverə uğurla çatdı (413 xətası həll edildi). Sənədin analizi üçün AI API kodunuzu server.js faylına əlavə edin.`;
        } else if (messages && messages.length > 0) {
            // Normal chat üçün müvəqqəti cavab (Siz bura AI kodunuzu qoyacaqsınız)
            const userLastMessage = messages[messages.length - 1].content;
            aiResponseText = `Sizin mesajınız serverə uğurla çatdı (404 xətası həll edildi): "${userLastMessage}". Süni intellekt cavabını qaytarmaq üçün AI API kodunuzu aktivləşdirin.`;
        }

        // =====================================================================

        // Frontend-in tam gözlədiyi formatda (data.content[0].text) cavabın qaytarılması
        return res.json({
            content: [
                { text: aiResponseText }
            ]
        });

    } catch (error) {
        console.error("Server xətası:", error);
        // Hər hansı qırılma olarsa, frontend-ə crash vermədən səbəbi qaytarır
        return res.status(500).json({
            content: [{ text: "Backend xətası: " + error.message }]
        });
    }
});

// Serveri işə salırıq
app.listen(PORT, () => {
    console.log(`🚀 Server uğurla işə salındı! Port: ${PORT}`);
});
