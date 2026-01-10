import { Worker } from "bullmq";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from 'dotenv'
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";

dotenv.config();

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "text-embedding-004",
  apiKey: process.env.GEMINI_API_KEY
});

const jobProcessor = async (job) => {
    // flow
    // get the pdf path
    // read the pdf using path,
    // divide into chunks
    // call the openai/embedding model for every chunk
    // save those embedding into qdrantdb
    const data = job.data;
    const path = data.path;
    const loader = new PDFLoader(path);
    const docs = await loader.load();

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000, // Max size of each chunk (in characters)
      chunkOverlap: 200, // Overlap between chunks to maintain context
    });

    const splitDocs = await splitter.splitDocuments(docs);
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      url: process.env.QDRANT_URL,
      collectionName: "career-timeline-collection",
    });

    await vectorStore.addDocuments(splitDocs)
    console.log(`All docs added to vector store`)

}

const worker = new Worker(
  'file-upload-queue',
  jobProcessor,
  { 
    concurrency: 5,
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    }
  },
);  


// For Debugging

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed`, err);
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

// Fix to stop it from exiting in docker
process.on("SIGTERM", async () => {
  console.log("Worker shutting down...");
  await worker.close();
  process.exit(0);
});
console.log("Worker started and listening for jobs...");



