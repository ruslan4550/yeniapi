const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ================== CORS + BODY ==================
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

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

// ================== GROQ ==================
// API KEY HEÇ VAXT KODA YAZILMIR.
// Render -> Environment -> GROQ_API_KEY
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const GROQ_CHAT_MODEL =
  process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Vision üçün fallback modellər
const VISION_MODELS = [
  process.env.GROQ_VISION_MODEL,
  'qwen/qwen3.6-27b',
  'qwen/qwen3.8-27b'
]
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i);

console.log('=========================================');
console.log('Normisera API başlayır');
console.log('GROQ_API_KEY təyin olunub:', !!GROQ_API_KEY);
console.log('Chat model:', GROQ_CHAT_MODEL);
console.log('Vision modelləri:', VISION_MODELS.join(', '));
console.log('=========================================');

function requireGroqKey() {
  if (!GROQ_API_KEY || !GROQ_API_KEY.startsWith('gsk_')) {
    throw new Error(
      'GROQ_API_KEY Render Environment-də təyin olunmayıb.'
    );
  }
}

// ================== DİL ==================
function getLanguageInstruction(lang) {
  switch (lang) {
    case 'ru':
      return 'ОБЯЗАТЕЛЬНО ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. Используй профессиональный, понятный юридический язык применительно к законодательству Азербайджанской Республики.';

    case 'en':
      return 'YOU MUST RESPOND ONLY IN ENGLISH. Use professional, clear legal language with reference to the legislation of the Republic of Azerbaijan.';

    case 'az':
    default:
      return 'MÜTLƏQ YALNIZ AZƏRBAYCAN DİLİNDƏ CAVAB VER. Azərbaycan Respublikasının qanunvericiliyinə uyğun peşəkar və aydın hüquqi terminologiyadan istifadə et.';
  }
}

// ================== CHAT ==================
async function callGroqChat(messages, systemPrompt) {
  requireGroqKey();

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_CHAT_MODEL,

      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        ...messages
      ],

      temperature: 0.25,
      max_tokens: 8192,
      reasoning_format: 'hidden'
    },

    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },

      timeout: 90000
    }
  );

  const text =
    response.data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('Groq boş cavab qaytardı.');
  }

  return text;
}

function isVisionAccessError(err) {
  const status = err.response?.status;

  const message = String(
    err.response?.data?.error?.message ||
    err.message ||
    ''
  ).toLowerCase();

  return (
    status === 400 ||
    status === 404 ||
    message.includes('does not exist') ||
    message.includes('do not have access') ||
    (
      message.includes('model') &&
      message.includes('access')
    )
  );
}

// ================== VISION ==================
async function callGroqVision(
  systemPrompt,
  userText,
  images
) {
  requireGroqKey();

  const list =
    Array.isArray(images)
      ? images
      : [images];

  const usableImages =
    list
      .filter(Boolean)
      .slice(0, 5);

  if (!usableImages.length) {
    throw new Error('Şəkil tapılmadı.');
  }

  const content = [
    {
      type: 'text',
      text: userText
    },

    ...usableImages.map(img => ({
      type: 'image_url',

      image_url: {
        url:
          img.dataUrl ||
          `data:${img.type || 'image/jpeg'};base64,${img.base64}`
      }
    }))
  ];

  let lastError = null;

  for (const model of VISION_MODELS) {
    try {

      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',

        {
          model,

          messages: [
            {
              role: 'system',
              content: systemPrompt
            },

            {
              role: 'user',
              content
            }
          ],

          temperature: 0.2,
          max_tokens: 8192,
          reasoning_format: 'hidden'
        },

        {
          headers: {
            Authorization:
              `Bearer ${GROQ_API_KEY}`,

            'Content-Type':
              'application/json'
          },

          timeout: 120000
        }
      );

      const text =
        response.data
          ?.choices?.[0]
          ?.message?.content;

      if (text) {
        return text;
      }

      lastError =
        new Error(
          `Vision modeli (${model}) boş cavab qaytardı.`
        );

    } catch (err) {

      lastError = err;

      console.error(
        'Vision model xətası:',
        model,
        err.response?.status,
        err.response?.data?.error?.message ||
          err.message
      );

      if (!isVisionAccessError(err)) {
        break;
      }
    }
  }

  const detail =
    lastError
      ?.response
      ?.data
      ?.error
      ?.message;

  throw new Error(
    detail
      ? `Groq Vision: ${detail}`
      : `Groq Vision xətası: ${
          lastError?.message ||
          'Bilinməyən xəta'
        }`
  );
}

// ================== FAYL MƏTNİ ==================
async function extractTextFromFile(fileData) {

  if (!fileData?.base64) {
    return null;
  }

  const buffer =
    Buffer.from(
      fileData.base64,
      'base64'
    );

  const type =
    String(
      fileData.type || ''
    ).toLowerCase();

  const name =
    String(
      fileData.name || ''
    ).toLowerCase();

  try {

    // ================= PDF =================
    if (
      type.includes('pdf') ||
      name.endsWith('.pdf')
    ) {

      const pdfParse =
        require('pdf-parse');

      const data =
        await pdfParse(buffer);

      return data.text || '';
    }

    // ================= DOCX =================
    if (
      type.includes('wordprocessingml') ||
      name.endsWith('.docx')
    ) {

      const mammoth =
        require('mammoth');

      const result =
        await mammoth.extractRawText({
          buffer
        });

      return result.value || '';
    }

    // ================= XLSX / XLS =================
    if (
      type.includes('spreadsheetml') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls')
    ) {

      const XLSX =
        require('xlsx');

      const wb =
        XLSX.read(
          buffer,
          {
            type: 'buffer'
          }
        );

      let text = '';

      wb.SheetNames.forEach(
        sheet => {

          text +=
            `\n--- Sheet: ${sheet} ---\n`;

          text +=
            XLSX.utils.sheet_to_csv(
              wb.Sheets[sheet]
            );
        }
      );

      return text;
    }

    // ================= TXT =================
    if (
      type.includes('text/plain') ||
      name.endsWith('.txt')
    ) {

      return buffer.toString(
        'utf8'
      );
    }

  } catch (err) {

    console.error(
      'Fayl emalı xətası:',
      err.message
    );
  }

  return null;
}

// ================== IMAGE YOXLA ==================
function fileLooksLikeImage(fileData) {

  const type =
    String(
      fileData?.type || ''
    ).toLowerCase();

  const name =
    String(
      fileData?.name || ''
    ).toLowerCase();

  return (
    type.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp)$/i.test(name)
  );
}

// ================== VISION ŞƏKİLLƏRİ ==================
function getVisionImages(fileData) {

  const images = [];

  // JPG / PNG
  if (
    fileData?.base64 &&
    fileLooksLikeImage(fileData)
  ) {

    images.push({
      base64: fileData.base64,
      type:
        fileData.type ||
        'image/jpeg'
    });
  }

  // PDF səhifələri
  if (
    Array.isArray(
      fileData?.pages
    )
  ) {

    for (
      const page of fileData.pages
    ) {

      if (page?.base64) {

        images.push({
          base64: page.base64,

          type:
            page.type ||
            'image/jpeg'
        });
      }
    }
  }

  return images.slice(0, 5);
}

// ================== CHAT SYSTEM PROMPT ==================
function buildChatSystemPrompt(
  baseSystem,
  lang
) {

  return `
${baseSystem ||
  'Sən Normisera hüquqi süni intellekt köməkçisisən.'}

SƏNİN DAVRANIŞ QAYDALARIN:

- İstifadəçinin sualını əvvəlcə düzgün başa düş.
- Hüquqi sənəd, ərizə, müqavilə və ya rəsmi mətn hazırlamaq istənilirsə, çatışmayan vacib məlumatları əvvəlcə soruş.
- Məsələn, istifadəçi "mənə müqavilə hazırla" deyirsə, dərhal uydurma ad, tarix, məbləğ və digər məlumatlarla müqavilə yazma.
- Əvvəlcə müqavilənin növünü, tərəflərin ad-soyadını və lazım olan əsas məlumatları soruş.
- Lazım olduqda ünvan, şəxsiyyət sənədi məlumatları, məbləğ, ödəniş qaydası, müddət, tarix, müqavilənin predmeti və digər vacib şərtləri soruş.
- İstifadəçi lazımi məlumatları artıq veribsə, eyni məlumatı yenidən soruşma.
- Heç vaxt ad, soyad, FIN, tarix, məbləğ və digər faktları özündən uydurma.
- Məlumat çatışmırsa, qısa və konkret suallar şəklində istə.
- Hazırlanan sənədləri səliqəli və kopyalana bilən mətn formasında ver.
- Hüquqi risk varsa, onu aydın şəkildə bildir.
- İstifadəçi sadəcə hüquqi sual verirsə, lazımsız şəxsi məlumat tələb etmə.
- Cavabları mümkün qədər konkret, faydalı və başa düşülən saxla.

[DİL TƏLƏBİ]

${getLanguageInstruction(
  lang || 'az'
)}
`;
}

// ================== /api/chat ==================
app.post(
  '/api/chat',
  async (req, res) => {

    try {

      const {
        system,
        messages,
        lang
      } = req.body;

      const validMessages =
        Array.isArray(messages)

          ? messages.map(m => ({
              role:
                m.role === 'assistant'
                  ? 'assistant'
                  : 'user',

              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(
                      m.content
                    )
            }))

          : [];

      const answerText =
        await callGroqChat(
          validMessages,

          buildChatSystemPrompt(
            system,
            lang
          )
        );

      res.json({
        content: [
          {
            text: answerText
          }
        ]
      });

    } catch (error) {

      console.error(
        'Chat API xətası:',
        error.message
      );

      res.status(500).json({
        content: [
          {
            text:
              'Xəta: ' +
              error.message
          }
        ]
      });
    }
  }
);

// ================== ANALİZ PROMPT ==================
function buildAnalysisPrompt(lang) {

  return `
Sən Normisera üçün peşəkar hüquqi sənəd analitikisən.

Təqdim olunan sənədi Azərbaycan Respublikası qanunvericiliyi kontekstində təhlil et.

ÇOX VACİB:

- İLK MƏRHƏLƏDƏ YALNIZ ANALİZ ET.
- İstifadəçi razılıq verməyənə qədər düzəldilmiş müqaviləni və ya yeni sənədi yazma.
- Sənəddə riskli, birtərəfli, qeyri-müəyyən və istifadəçinin hüquqlarını məhdudlaşdıra bilən bəndləri konkret göstər.
- Maddə/bənd nömrəsi görünürsə qeyd et.
- Cərimələrə diqqət yetir.
- Ödəniş şərtlərinə diqqət yetir.
- Məsuliyyət şərtlərinə diqqət yetir.
- Ləğv və xitam şərtlərinə diqqət yetir.
- Müddət və avtomatik uzadılmaya diqqət yetir.
- Birtərəfli dəyişiklik hüququna diqqət yetir.
- Məxfilik və şəxsi məlumatlara diqqət yetir.
- Yurisdiksiya və mübahisələrin həllinə diqqət yetir.
- Sənəddə olmayan məlumatı uydurma.

CAVAB STRUKTURU:

1. ⚠️ RİSKLİ BƏNDLƏR

2. 🔎 ÇATIŞMAYAN / QEYRİ-MÜƏYYƏN HİSSƏLƏR

3. 📌 ÜMUMİ NƏTİCƏ

4. Sonda istifadəçiyə bildir:

"İstəsəniz, razılığınızdan sonra riskləri azaldılmış və daha balanslı versiyanı hazırlaya bilərəm."

[DİL]

${getLanguageInstruction(
  lang || 'az'
)}
`;
}

// ================== /api/analyze ==================
app.post(
  '/api/analyze',
  async (req, res) => {

    try {

      const {
        messages,
        plan,
        fileData,
        lang
      } = req.body;

      if (plan === 'Pulsuz') {

        return res.json({
          content: [
            {
              text:
                'Sənəd analizi funksiyası yalnız Premium və Biznes paketlərində mövcuddur. Zəhmət olmasa paketinizi yeniləyin.'
            }
          ]
        });
      }

      if (
        !fileData?.base64
      ) {

        return res.status(400).json({
          content: [
            {
              text:
                'Sənəd tapılmadı. Zəhmət olmasa fayl yükləyin.'
            }
          ]
        });
      }

      const prompt =
        buildAnalysisPrompt(
          lang
        );

      const isImage =
        fileLooksLikeImage(
          fileData
        );

      const visionImages =
        getVisionImages(
          fileData
        );

      let answerText;

      // ================= IMAGE =================
      if (
        isImage
      ) {

        answerText =
          await callGroqVision(

            prompt,

            (
              messages?.[0]?.content ||
              'Sənədi oxu və yalnız hüquqi risklərini analiz et. Düzəldilmiş sənədi hələ hazırlama.'
            ),

            visionImages
          );

      }

      // ================= PDF / DOCX / XLSX =================
      else {

        const extracted =
          await extractTextFromFile(
            fileData
          );

        // Mətnli sənəd
        if (
          extracted &&
          extracted.trim().length >= 10
        ) {

          const trimmed =
            extracted.slice(
              0,
              50000
            );

          answerText =
            await callGroqChat(

              [
                {
                  role: 'user',

                  content:
                    `
Aşağıdakı sənədi yalnız hüquqi risklər baxımından analiz et.

Hələ düzəldilmiş sənəd hazırlama.

--- SƏNƏD BAŞLANĞICI ---

${trimmed}

--- SƏNƏD SONU ---
`
                }
              ],

              prompt
            );
        }

        // Skan PDF
        else if (
          Array.isArray(
            fileData.pages
          ) &&
          fileData.pages.length
        ) {

          answerText =
            await callGroqVision(

              prompt,

              'Bu skan edilmiş PDF sənədinin səhifələrini oxu. OCR et və yalnız hüquqi riskləri analiz et. Hələ düzəldilmiş sənəd hazırlama.',

              fileData.pages
            );

        }

        else {

          return res.status(422).json({
            content: [
              {
                text:
                  'PDF mətnli deyil və səhifə şəkilləri alınmadı. Sənədi yenidən yükləyin və ya PDF-i JPG/PNG kimi göndərin.'
              }
            ]
          });
        }
      }

      res.json({

        content: [
          {
            text: answerText
          }
        ],

        needsConsent: true
      });

    } catch (error) {

      console.error(
        'Analyze API xətası:',
        error.message
      );

      res.status(500).json({
        content: [
          {
            text:
              'Sənəd analizi zamanı xəta baş verdi: ' +
              error.message
          }
        ]
      });
    }
  }
);

// ================== REWRITE PROMPT ==================
function buildRewritePrompt(lang) {

  return `
Sən Normisera üçün peşəkar hüquqi sənəd redaktorusan.

İstifadəçi sənədin risklərinin analizindən sonra onun düzəldilmiş versiyasının hazırlanmasına AÇIQ ŞƏKİLDƏ RAZILIQ VERİB.

Tapşırıq:

- Orijinal sənədi tam oxu.
- Sənədin əsas məqsədini və strukturunu qoruyaraq yenidən hazırla.
- Riskli və birtərəfli şərtləri mümkün qədər balanslı və aydın şərtlərlə əvəz et.
- Ad, soyad, FIN, tarix, məbləğ, ünvan, rekvizit və digər faktları UYDURMA.
- Orijinalda olmayan məlumat lazımdırsa [DAXİL EDİLMƏLİDİR] yaz.
- Sənədin vacib hissələrini silmə.
- Yekun sənəd istifadəyə hazır formada olsun.
- Cavabda yalnız yekun sənəd mətnini ver.
- Analiz və əlavə izah yazma.

[DİL]

${getLanguageInstruction(
  lang || 'az'
)}
`;
}

// ================== /api/rewrite ==================
app.post(
  '/api/rewrite',
  async (req, res) => {

    try {

      const {
        fileData,
        lang,
        analysis
      } = req.body;

      if (
        !fileData?.base64
      ) {

        return res.status(400).json({
          error:
            'Sənəd tapılmadı.'
        });
      }

      const prompt =
        buildRewritePrompt(
          lang
        );

      const isImage =
        fileLooksLikeImage(
          fileData
        );

      let documentText;

      // ================= IMAGE =================
      if (isImage) {

        documentText =
          await callGroqVision(

            prompt,

            'İstifadəçi razılıq verib. Şəkildəki sənədi tam oxu və riskləri azaldılmış, balanslaşdırılmış yekun sənədi hazırla. Yalnız yekun sənədi qaytar.',

            getVisionImages(
              fileData
            )
          );
      }

      // ================= TEXT FILE =================
      else {

        const extracted =
          await extractTextFromFile(
            fileData
          );

        if (
          extracted &&
          extracted.trim().length >= 10
        ) {

          documentText =
            await callGroqChat(

              [
                {
                  role: 'user',

                  content:
                    `
İstifadəçi razılıq verib.

Aşağıdakı sənədi tam şəkildə yenidən hazırla.

--- ORİJİNAL SƏNƏD ---

${extracted.slice(
  0,
  50000
)}

--- ORİJİNAL SƏNƏD SONU ---

ƏVVƏLKİ RİSK ANALİZİ:

${String(
  analysis || ''
).slice(
  0,
  15000
)}
`
                }
              ],

              prompt
            );

        }

        // ================= SCANNED PDF =================
        else if (
          Array.isArray(
            fileData.pages
          ) &&
          fileData.pages.length
        ) {

          documentText =
            await callGroqVision(

              prompt,

              `
İstifadəçi razılıq verib.

Bu skan edilmiş PDF səhifələrindən tam sənədi oxu və riskləri azaldılmış, balanslaşdırılmış yekun sənədi hazırla.

Əvvəlki analiz:

${String(
  analysis || ''
).slice(
  0,
  12000
)}
`,

              fileData.pages
            );

        }

        else {

          return res.status(422).json({
            error:
              'Sənəddən oxuna bilən mətn və ya PDF səhifə şəkilləri alınmadı.'
          });
        }
      }

      const safeName =
        String(
          fileData.name ||
          'sened'
        )

        .replace(
          /\.[^.]+$/,
          ''
        )

        .replace(
          /[^a-zA-Z0-9_-]+/g,
          '-'
        )

        .slice(
          0,
          80
        ) || 'Normisera';

      res.json({

        documentText,

        fileName:
          `${safeName}-duzeltilmis.doc`
      });

    } catch (error) {

      console.error(
        'Rewrite API xətası:',
        error.message
      );

      res.status(500).json({
        error:
          'Düzəldilmiş sənəd hazırlanarkən xəta baş verdi: ' +
          error.message
      });
    }
  }
);

// ================== TTS ==================
app.get(
  '/api/tts',
  async (req, res) => {

    try {

      const text =
        String(
          req.query.text || ''
        );

      const lang =
        String(
          req.query.lang || 'az'
        );

      if (!text) {
        return res.status(400)
          .send(
            'Mətn tələb olunur'
          );
      }

      const tl =
        {
          az: 'az',
          ru: 'ru',
          en: 'en'
        }[lang] || 'az';

      const clean =
        text

          .replace(
            /<[^>]*>?/gm,
            ''
          )

          .replace(
            /[*_#`~]/g,
            ''
          )

          .slice(
            0,
            200
          );

      const url =
        `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(clean)}&tl=${tl}&client=tw-ob`;

      const response =
        await axios.get(
          url,
          {
            responseType:
              'stream',

            headers: {
              'User-Agent':
                'Mozilla/5.0',

              Referer:
                'https://translate.google.com/'
            },

            timeout: 20000
          }
        );

      res.set(
        'Content-Type',
        'audio/mpeg'
      );

      response.data.pipe(res);

    } catch (error) {

      console.error(
        'TTS xətası:',
        error.message
      );

      res.status(500).send(
        'Səs yaradılarkən xəta baş verdi'
      );
    }
  }
);

// ================== HEALTH ==================
app.get(
  '/',
  (req, res) => {
    res.send(
      'Normisera Backend API işləyir ✅'
    );
  }
);

app.get(
  '/health',
  (req, res) => {

    const keyValid =
      !!GROQ_API_KEY &&
      GROQ_API_KEY.startsWith('gsk_') &&
      GROQ_API_KEY.length > 20;

    res.json({

      ok: true,

      groqKeySet:
        keyValid,

      chatModel:
        GROQ_CHAT_MODEL,

      visionModels:
        VISION_MODELS
    });
  }
);

// ================== SERVER ==================
app.listen(
  PORT,
  () => {
    console.log(
      `✅ Normisera API server port ${PORT}-də işləyir`
    );
  }
);