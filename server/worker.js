import { Worker } from "bullmq";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from 'dotenv'
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import {QdrantClient} from '@qdrant/js-client-rest';
import { QdrantVectorStore } from "@langchain/qdrant";
import * as z from "zod";

dotenv.config();


 
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

    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: "text-embedding-004",
      apiKey: process.env.GEMINI_API_KEY
    });

    const client = new QdrantClient({url: process.env.QDRANT_URL });
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      url: process.env.QDRANT_URL,
      collectionName: "career-timeline-collection",
    });

    await vectorStore.addDocuments(splitDocs)
    console.log(`All docs added to vector store`)

    
}

async function queryPDF(){

  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: process.env.GEMINI_API_KEY
  });
  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: process.env.QDRANT_URL,
    collectionName: "career-timeline-collection",
  });
  
  const query = "What is phone number of Sujal Gupta?"
  const retrievedDocs = await vectorStore.similaritySearch(query, 2);
    const serialized = retrievedDocs
      .map(
        (doc) => `Source: ${doc.metadata.source}\nContent: ${doc.pageContent}`
      )
      .join("\n");
  console.log("serialized", serialized);
}

const worker = new Worker(
  'file-upload-queue',
  jobProcessor,
  { 
    concurrency: 100,
    connection: {
      host: 'localhost',
      port: 6379,
    }
  },
);  