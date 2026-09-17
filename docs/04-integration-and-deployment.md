# 🛠️ Guide d'Intégration Technique & Déploiement Production

> **Déploiement Docker, utilisation API/SDK, intégration CI/CD et respect de la conformité RGPD souveraine.**

---

## 📑 Table des Matières
1. [Architecture & Sécurité In-Memory (Zero Data Leak)](#1-architecture--sécurité-in-memory-zero-data-leak)
2. [Déploiement Conteneurisé Docker](#2-déploiement-conteneurisé-docker)
3. [Intégration via l'API REST (Python, Node.js, cURL)](#3-intégration-via-lapi-rest-python-nodejs-curl)
4. [Intégration Directe en Bibliothèque (SDK Interne)](#4-intégration-directe-en-bibliothèque-sdk-interne)
5. [Automatisation CI/CD (GitHub Actions / GitLab CI)](#5-automatisation-cicd-github-actions--gitlab-ci)
6. [Monitoring & Healthchecks](#6-monitoring--healthchecks)

---

## 1. Architecture & Sécurité In-Memory (Zero Data Leak)

L'architecture de **Doc2KB Studio** a été spécifiquement conçue pour répondre aux contraintes réglementaires les plus strictes (**RGPD, HIPAA, Secret d'Affaires**) :

```
Requête HTTP (Fichier binaire)
         │
         ▼
[Multer MemoryStorage] ──► Mémoire RAM (Buffer éphémère)
         │
         ▼
[Moteur de Parsing & OCR] ──► Traitement local en mémoire
         │
         ▼
[Optimisation & Chunker] ──► Minification des tokens
         │
         ▼
Réponse HTTP (JSON / ZIP) ──► Destruction du Buffer RAM par le Garbage Collector
```

### Garanties Techniques :
* **Aucun stockage temporaire sur disque** : Les fichiers ne sont jamais écrits dans `/tmp` ou un dossier local.
* **Aucun appel vers des API tierces externes** : L'OCR (Tesseract.js) et la tokenisation (js-tiktoken) tournent localement sur votre processeur.
* **Stateless** : L'application n'a pas d'état persistant, ce qui la rend naturellement scalable horizontalement.

---

## 2. Déploiement Conteneurisé Docker

Le projet inclut un [`Dockerfile`](file:///mnt/BACKUP/transformation/Dockerfile) officiel optimisé sur **Node 24 Alpine** (< 180 Mo).

### A. Construction de l'Image :
```bash
docker build -t doc2kb-studio:2.0 .
```

### B. Lancement du Conteneur :
```bash
docker run -d \
  --name doc2kb \
  -p 3000:3000 \
  --restart unless-stopped \
  --memory="2g" \
  --cpus="2" \
  doc2kb-studio:2.0
```

### C. Déploiement Docker Compose :
Créez un fichier `docker-compose.yml` :

```yaml
version: '3.8'

services:
  doc2kb-studio:
    build: .
    image: doc2kb-studio:2.0
    container_name: doc2kb-studio
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'
        reservations:
          memory: 1G
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/status"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Lancement :
```bash
docker compose up -d
```

---

## 3. Intégration via l'API REST

### A. Client Python (Intégration Pipeline RAG / Airflow) :

```python
import requests
import json

API_URL = "http://localhost:3000/api/convert"

def process_file_for_rag(file_path):
    with open(file_path, "rb") as f:
        files = {"file": f}
        data = {
            "level": "ultra_compact",
            "injectFrontmatter": "true",
            "includeRag": "true",
            "chunkMaxTokens": 500
        }
        response = requests.post(API_URL, files=files, data=data)
        response.raise_for_status()
        
        result = response.json()["result"]
        print(f"✅ {result['outputFilename']} traité :")
        print(f"   - Tokens initiaux : {result['savings']['originalTokens']}")
        print(f"   - Tokens optimisés : {result['savings']['optimizedTokens']} (-{result['savings']['savingsPercentage']}%)")
        print(f"   - Chunks générés : {result['rag']['totalChunks']}")
        
        return result["rag"]["chunks"]

# Exemple d'appel
chunks = process_file_for_rag("rapport_annuel.docx")
```

### B. Client Node.js / TypeScript :

```typescript
import axios from 'axios';
import fs from 'node:fs';
import FormData from 'form-data';

async function optimizeDocument(filePath: string) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('level', 'ultra_compact');
  form.append('includeRag', 'true');

  const { data } = await axios.post('http://localhost:3000/api/convert', form, {
    headers: form.getHeaders(),
  });

  return data.result;
}
```

---

## 4. Intégration Directe en Bibliothèque (SDK Interne)

Si votre application tourne sous Node.js (v20 ou v24), vous pouvez importer directement la logique de `lib/` sans passer par le réseau HTTP :

```javascript
import fs from 'node:fs';
import { convertFileToMarkdown } from './lib/converter.js';
import { buildKnowledgeBase } from './lib/knowledgeBaseService.js';

// Conversion locale en mémoire
const buffer = fs.readFileSync('contrat.xlsx');
const doc = await convertFileToMarkdown(buffer, 'contrat.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
  level: 'ultra_compact',
  includeRag: true
});

// Compilation de la base de connaissances
const kb = buildKnowledgeBase([doc], {
  projectTitle: "Knowledge Base Finance",
  level: "ultra_compact"
});

console.log(kb.llmsTxt); // Le fichier llms.txt standard
console.log(kb.ragJsonl); // Le flux JSONL prêt pour la base vectorielle
```

---

## 5. Automatisation CI/CD (GitHub Actions)

Pour régénérer automatiquement vos fichiers `llms.txt` et `rag-chunks.jsonl` à chaque release de documentation :

```yaml
name: Generate Knowledge Base

on:
  push:
    branches: [ main ]
    paths:
      - 'docs/**'

jobs:
  build-kb:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: node scripts/compile-knowledge-base.js
      - name: Deploy to Cloudflare Pages / S3
        run: |
          aws s3 cp public/llms.txt s3://my-bucket/llms.txt
          aws s3 cp public/llms-full.txt s3://my-bucket/llms-full.txt
```

---

## 6. Monitoring & Healthchecks

Doc2KB Studio expose un endpoint de diagnostic léger :

`GET /api/status`

```json
{
  "status": "ok",
  "app": "Doc2KB Studio",
  "version": "2.0.0",
  "capabilities": {
    "converters": ["docx", "pdf", "xlsx", "csv", "html", "ocr_images", "txt_code"],
    "tokenizer": "js-tiktoken (cl100k_base, o200k_base)",
    "ragChunking": true,
    "llmsTxtStandard": "llmstxt.org v0.1",
    "tokenOptimizer": ["raw", "clean", "ultra_compact"]
  }
}
```

Ce endpoint est utilisable par les sondes de liveness et readiness de **Kubernetes**, **AWS ECS** ou **Docker Swarm**.
