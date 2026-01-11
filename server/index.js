import express from 'express';
import multer from 'multer';
import cors from 'cors'
import { Queue } from 'bullmq';
import { QdrantVectorStore } from "@langchain/qdrant";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import fs from 'fs'

import dotenv from 'dotenv'

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

dotenv.config();

const PORT = process.env.PORT || 3001;
const app = express();
app.use(express.json());
app.use(cors({
    origin: true
}))
// queue setup
const q = new Queue('file-upload-queue', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port:  Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD
    }
});

let retriever;

async function initVectorStore() {
  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: process.env.GEMINI_API_KEY
  });

  const vectorStore = await QdrantVectorStore.fromExistingCollection(
    embeddings,
    {
      url: process.env.QDRANT_URL,
      collectionName: "career-timeline-collection",
      // apiKey: process.env.QDRANT_API_KEY
    }
  );

  retriever = vectorStore.asRetriever({ k: 2 });
}

await initVectorStore();

// multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null,  'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})
const upload = multer({ storage });

const llm = new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    temperature: 0,
    maxRetries: 0,
    apiKey: process.env.GEMINI_API_KEY,
    
    // other params...
})

app.get('/', (req, res) => {
    return res.status(200).json({
        status: "All Good"
    })
})

app.get('/ask', async (req, res) => {
    const query = req.query.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Invalid query" });
    }
    console.log(query)
    const r = await retriever.invoke(query);
    console.log(r);

    const context = r.map(doc => doc.pageContent).join("\n---\n");
    console.log(
      "context", context
    )

    const SYSTEM_PROMPT = `
    Answer ONLY using the context below.
    If the answer is not present, say "Not found in document".

    Context:
    ${context}
    `;

    const aiMsg = await llm.invoke([
        [ "system", SYSTEM_PROMPT ],
        ["human", query]
    ]);

    console.log(aiMsg)

    return res.status(200).json({
        message: aiMsg.content
    })
})

app.post('/upload/pdf', upload.single('pdfFile'),  async (req, res) => {
    const file = req.file;
    if(!file){
        return res.status(400).json({
            error: "no file received"
        })
    }
    const r = await q.add('chunkify', {
        name: req.file.originalname,
        dest: req.file.destination,
        path: req.file.path
    }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    return res.status(202).json({
        success: true,
        message: "PDF uploaded successfully"
    })
})


app.listen(PORT, "0.0.0.0", (err) => {
    if(err){
        console.log(err)
    }else{
        console.log(`Server running`);
    }
})