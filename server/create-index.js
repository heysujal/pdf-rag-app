import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from 'dotenv';

dotenv.config();

async function createEmailIndex() {
    console.log("🔧 Creating email index in Qdrant...");
    
    const client = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY
    });

    try {
        // Create payload index for email filtering
        await client.createPayloadIndex("career-timeline-collection", {
            field_name: "metadata.email",
            field_schema: "keyword"
        });
        
        console.log("✅ Successfully created index for metadata.email");
        console.log("📍 You can now filter documents by email");
        
    } catch (error) {
        if (error.message?.includes("already exists")) {
            console.log("ℹ️  Index already exists - no action needed");
        } else {
            console.error("❌ Error creating index:", error);
            throw error;
        }
    }
    
    process.exit(0);
}

createEmailIndex();