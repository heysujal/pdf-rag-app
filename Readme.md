- how to deploy?

creating docker compose and docker file

bullmq exiting directly

do not create collection name at runtime -> getting collection already exists

server and workers should share volumes

First messed with creating seperate dockerfiles and creating seperate service for Server and Worker
but they couldn't share file system -> so other way was to add bucket.

Skipped s3 approach and tried deploying using a single service using one Dockerfile.mono and for persistance attached volume 
in railway to my pdf rag service.


Future Scope

- Storage of PDF per user and only fetch docs from their collections
- Chat UI improvment
- Showing the relevant PDF artifact being referred to answer the question
