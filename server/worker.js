import { Worker } from "bullmq";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from 'dotenv'
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import fs from 'fs';

dotenv.config();

// Log environment configuration (without exposing secrets)
console.log("🔧 Worker environment configuration:");
console.log(`  - QDRANT_URL: ${process.env.QDRANT_URL || 'NOT SET'}`);
console.log(`  - QDRANT_API_KEY: ${process.env.QDRANT_API_KEY ? 'SET' : 'NOT SET'}`);
console.log(`  - REDIS_HOST: ${process.env.REDIS_HOST || 'localhost'}`);
console.log(`  - REDIS_PORT: ${process.env.REDIS_PORT || '6379'}`);
console.log(`  - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET'}`);

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001",  // ✅ FIXED: Correct Google AI embedding model
  apiKey: process.env.GEMINI_API_KEY
});

// ========================================
// CREATE INDEX FOR EMAIL FILTERING
// ========================================
async function ensureEmailIndex() {
    const client = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY
    });

    try {
        // Check if collection exists
        const collections = await client.getCollections();
        const collectionExists = collections.collections.some(
            col => col.name === "career-timeline-collection"
        );

        if (!collectionExists) {
            console.log("⚠️  Collection doesn't exist yet, will create on first document");
            return;
        }

        // Create index for email field if it doesn't exist
        try {
            await client.createPayloadIndex("career-timeline-collection", {
                field_name: "metadata.email",
                field_schema: "keyword"
            });
            console.log("✅ Created payload index for metadata.email");
        } catch (error) {
            if (error.message?.includes("already exists")) {
                console.log("ℹ️  Email index already exists");
            } else {
                console.log("⚠️  Could not create index (will retry):", error.message);
            }
        }
    } catch (error) {
        console.error("❌ Error ensuring email index:", error);
    }
}

const jobProcessor = async (job) => {
    try {
        console.log(`🔄 Processing job ${job.id}...`);
        const data = job.data;
        const {name, email, path} = data;
        
        console.log(`📄 Loading PDF: ${name} for email: ${email}`);
        console.log(`📁 File path: ${path}`);
        
        if (!email || !email.trim()) {
            throw new Error("Email is required but not provided");
        }
        
        // Check if file exists
        if (!fs.existsSync(path)) {
            throw new Error(`PDF file not found at path: ${path}`);
        }
        
        console.log(`✅ File exists, loading PDF...`);
        const loader = new PDFLoader(path);
        const docs = await loader.load();
        console.log(`✅ Loaded ${docs.length} pages from PDF`);

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        const splitDocs = await splitter.splitDocuments(docs);
        console.log(`✂️  Split into ${splitDocs.length} chunks`);
        
        if (splitDocs.length === 0) {
            throw new Error("No text chunks extracted from PDF");
        }
        
        // ✅ FIXED: Store email in metadata, not as top-level field
        const docsWithMetaData = splitDocs.map(doc => {
          return {
            pageContent: doc.pageContent,
            metadata: {
              ...doc.metadata,
              fileName: name,
              email: email  // ✅ Store email in metadata
            }
          }
        });
        
        console.log(`🔗 Connecting to Qdrant at ${process.env.QDRANT_URL}`);
        
        let vectorStore;
        const collectionConfig = {
            url: process.env.QDRANT_URL,
            collectionName: "career-timeline-collection",
        };
        
        if (process.env.QDRANT_API_KEY) {
            collectionConfig.apiKey = process.env.QDRANT_API_KEY;
            console.log(`🔑 Using Qdrant API key for authentication`);
        }
        
        try {
            // Try to connect to existing collection
            vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, collectionConfig);
            console.log(`✅ Connected to existing collection`);
            
            // Ensure email index exists
            await ensureEmailIndex();
        } catch (error) {
            // If collection doesn't exist, create it
            console.log(`⚠️  Collection doesn't exist (${error.message}), creating it...`);
            vectorStore = await QdrantVectorStore.fromDocuments(
                docsWithMetaData,
                embeddings,
                collectionConfig
            );
            console.log(`✅ Created new collection with ${docsWithMetaData.length} documents`);
            
            // Create index after collection is created
            await ensureEmailIndex();
            return;
        }
        
        // Collection exists, add new documents
        console.log(`💾 Adding ${docsWithMetaData.length} documents to existing collection...`);
        await vectorStore.addDocuments(docsWithMetaData);
        console.log(`✅ Successfully added ${docsWithMetaData.length} documents for email: ${email}`);
        
    } catch (error) {
        console.error(`❌ Error processing job ${job.id}:`, error);
        console.error(`Error details:`, {
            message: error.message,
            stack: error.stack,
            jobData: job.data
        });
        throw error;
    }
}

const worker = new Worker(
  'file-upload-queue',
  jobProcessor,
  { 
    concurrency: 5,
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD
    }
  },
);  

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err);
});

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

process.on("SIGTERM", async () => {
  console.log("Worker shutting down...");
  await worker.close();
  process.exit(0);
});

console.log("👷 Worker started and listening for jobs...");