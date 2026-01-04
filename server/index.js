import express from 'express';
import multer from 'multer';
import cors from 'cors'
import { Queue } from 'bullmq';
import { QdrantVectorStore } from "@langchain/qdrant";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"

import dotenv from 'dotenv'

dotenv.config();

const PORT = 3001;
const app = express();
app.use(express.json());
app.use(cors({
    origin: true
}))
// queue setup
const q = new Queue('file-upload-queue', {
    connection: {
      host: 'localhost',
      port: 6379,
    }
});

const queryQueue = new Queue('resolve-query-queue', {
    connection: {
        host: 'localhost',
        port: 6379
    }
})

const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: process.env.GEMINI_API_KEY
});

const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: process.env.QDRANT_URL,
    collectionName: "career-timeline-collection",
});

const retriever = vectorStore.asRetriever({
    k: 2
});
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
    console.log(query)
    const r = await retriever.invoke(query);
    const SYSTEM_PROMPT = `You are a helpful AI assitant which answers based on the context of a PDF available to your.
    Context: ${JSON.stringify(r)}`

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
    });
    return res.status(202).json({
        success: true,
        message: "PDF uploaded successfully"
    })
})


app.listen(PORT, (err) => {
    if(err){
        console.log(err)
    }else{
        console.log(`Server running`);
    }
})