## Local Development Setup

### Prerequisites
- Docker and Docker Compose installed
- Node.js 22+ (for local development without Docker)

### Quick Start

1. **Set up environment variables:**
   ```bash
   cp server/.env.example server/.env
   ```
   Then edit `server/.env` and add your `GEMINI_API_KEY`.
   
   **For Cloud Qdrant (optional):**
   - Set `QDRANT_URL` to your cloud Qdrant URL (e.g., `https://your-cluster-id.qdrant.io`)
   - Set `QDRANT_API_KEY` to your Qdrant API key
   - If using cloud Qdrant, you can comment out the `qdrant` service in `docker-compose.yml` (optional)

2. **Start all services with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

3. **Access the services:**
   - Server API: http://localhost:3001
   - Qdrant UI: http://localhost:6333
   - Redis: localhost:6379

### Hot Reload Development

The docker-compose.yml is configured for local development with hot-reload:
- **Code changes** in `server/index.js` and `server/worker.js` will automatically reload
- Uses `node --watch` for automatic restarts on file changes
- Server code is mounted as a volume, so changes are reflected immediately

### Troubleshooting

**Changes not reflecting?**
- Make sure you're editing files in the `server/` directory
- Check that volumes are mounted correctly: `docker-compose ps`
- Restart containers: `docker-compose restart server worker`

**Port already in use?**
- Change ports in `docker-compose.yml` if 3001, 6333, or 6379 are taken

**Environment variables not loading?**
- Ensure `server/.env` exists and contains all required variables
- Check docker-compose logs: `docker-compose logs server`

## Deployment

- how to deploy?

creating docker compose and docker file

bullmq exiting directly

do not create collection name at runtime -> getting collection already exists

server and workers should share volumes

First messed with creating seperate dockerfiles and creating seperate service for Server and Worker
but they couldn't share file system -> so other way was to add bucket.

Skipped s3 approach and tried deploying using a single service using one Dockerfile.mono and for persistance attached volume 
in railway to my pdf rag service.

## Future Scope

- ✅ Storage of PDF per user and only fetch docs from their collections (Implemented)
- Chat UI improvement
- Showing the relevant PDF artifact being referred to answer the question
- Server notifies when PDF upload is complete
- Tracking of Jobs in logs. Handling failure of a Job.
