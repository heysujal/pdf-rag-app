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

const PORT = process.env.PORT || 8080;
const app = express();
app.use(express.json());
app.use(cors({
    origin: true
}))

// ========================================
// LAZY INITIALIZATION PATTERN
// ========================================
let retriever = null;
let initPromise = null;

async function getRetriever() {
  // If already initialized, return immediately
  if (retriever) return retriever;
  
  // If initialization in progress, wait for it
  if (initPromise) return initPromise;
  
  // Start initialization
  initPromise = (async () => {
    try {
      const embeddings = new GoogleGenerativeAIEmbeddings({
        model: "text-embedding-004",
        apiKey: process.env.GEMINI_API_KEY
      });

      const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
          url: process.env.QDRANT_URL,
          collectionName: "career-timeline-collection",
        }
      );

      retriever = vectorStore.asRetriever({ k: 5 });
      console.log("✅ Qdrant retriever initialized");
      return retriever;
    } catch (err) {
      console.error("❌ Qdrant init failed:", err.message);
      initPromise = null; // Reset so it can retry
      throw err;
    }
  })();
  
  return initPromise;
}

// ========================================
// QUEUE SETUP
// ========================================
const q = new Queue('file-upload-queue', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD
    }
});

// ========================================
// MULTER SETUP
// ========================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})
const upload = multer({ storage });

// ========================================
// LLM SETUP
// ========================================
const llm = new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    temperature: 0,
    maxRetries: 2,
    apiKey: process.env.GEMINI_API_KEY,
})

// ========================================
// ROUTES
// ========================================

// Health check - does NOT depend on Qdrant
app.get('/', (req, res) => {
    return res.status(200).json({
        status: "ok",
        service: "pdf-rag-server"
    })
})

// Query endpoint - lazily initializes Qdrant
app.get('/ask', async (req, res) => {
    const query = req.query.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Invalid query" });
    }
    
    try {
      // Get retriever (initializes on first call)
      const r = await getRetriever();
      
      console.log("Query:", query);
      const docs = await r.invoke(query);
      console.log(`Retrieved ${docs.length} chunks`);

      const context = docs.map(doc => doc.pageContent).join("\n---\n");

      const SYSTEM_PROMPT = `Answer ONLY using the context below.
If the answer is not present, say "Not found in document".

Context:
${context}`;

      const aiMsg = await llm.invoke([
          ["system", SYSTEM_PROMPT],
          ["human", query]
      ]);

      return res.status(200).json({
          message: aiMsg.content
      })
    } catch (err) {
      console.error("Error in /ask:", err);
      return res.status(503).json({
        error: "Service temporarily unavailable",
        details: err.message
      });
    }
})

// Upload endpoint - does NOT depend on Qdrant
app.post('/upload/pdf', upload.single('pdfFile'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({
            error: "no file received"
        })
    }
    
    try {
      await q.add('chunkify', {
          name: file.originalname,
          dest: file.destination,
          path: file.path
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
    } catch (err) {
      console.error("Queue error:", err);
      return res.status(500).json({
        error: "Failed to queue PDF processing",
        details: err.message
      });
    }
})

// ========================================
// GRACEFUL SHUTDOWN
// ========================================
const shutdown = async (signal) => {
    console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);
    
    try {
        // Close queue connections
        await q.close();
        console.log("✅ BullMQ queue closed");
        
        // Close server
        console.log("✅ Server stopped");
        console.log("👋 Goodbye!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error during shutdown:", err);
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ========================================
// SERVER START
// ========================================
app.listen(PORT, "0.0.0.0", (err) => {
    if (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    } else {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📍 Health check: http://0.0.0.0:${PORT}/`);
    }
})