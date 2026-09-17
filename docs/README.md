# 📚 Centre de Documentation Technique — Doc2KB Studio

> **Base de connaissances pour l'optimisation des tokens, le chunking sémantique RAG et l'implémentation de la norme llms.txt.**

Bienvenue dans la documentation technique approfondie de **Doc2KB Studio**. Ce dossier rassemble les guides d'architecture, les meilleures pratiques de l'industrie et les spécifications formelles pour transformer des données non structurées en bases de connaissances haute performance pour l'IA générative.

---

## 🗺️ Sommaire des Guides

### [1. 💰 Guide de l'Économie de Tokens & FinOps IA](01-token-economy-guide.md)
* **Pourquoi le lire** : Comprendre en détail la mécanique BPE (Byte-Pair Encoding), pourquoi les formats bruts ruinent vos fenêtres de contexte, et comment réduire de 30% à 60% votre facture d'API LLM (OpenAI, Claude, Gemini).
* **Au programme** :
  * Fonctionnement de `cl100k_base` et `o200k_base`.
  * Règles d'or d'architecture pour le **Prompt Caching** (Context Caching).
  * Minification chirurgicale des tableaux Markdown sans perte sémantique.
  * Étude de cas chiffrée & modèle de calcul de ROI.

### [2. 🧩 Guide des Meilleures Pratiques RAG & Découpage Sémantique](02-rag-best-practices.md)
* **Pourquoi le lire** : Éviter le syndrome *"Garbage In, Garbage Out"* dans vos pipelines de recherche vectorielle.
* **Au programme** :
  * Découpage Structure-Aware vs découpage naïf aveugle.
  * Injection automatique du **fil d'Ariane (`breadcrumbs`)** pour préserver le contexte (*Contextual Retrieval*).
  * Traitement atomique des données tabulaires et élimination des cellules orphelines.
  * Schéma du format standard **`rag-chunks.jsonl`** et code d'ingestion Python (ChromaDB / Pinecone).
  * Architecture en 2 étapes : Dense Retrieval + Cross-Encoder Reranking.

### [3. 📑 Spécification & Implémentation de la Norme llms.txt](03-llms-txt-standard.md)
* **Pourquoi le lire** : Maîtriser le standard émergent proposé par Jeremy Howard (Answer.AI) pour rendre vos documentations et projets lisibles par les agents d'IA.
* **Au programme** :
  * Différence entre `robots.txt`, `sitemap.xml` et `llms.txt`.
  * Anatomie formelle et règles de syntaxe d'un fichier `llms.txt`.
  * Le triptyque : `llms.txt` (Index), `llms-full.txt` (Corpus complet), `llms-small.txt` (Digest).
  * Optimisation GEO (*Generative Engine Optimization*) pour ChatGPT Search, Perplexity et Claude.
  * Découverte automatique via en-têtes HTTP `Link: rel="describedby"`.

### [4. 🛠️ Guide d'Intégration Technique & Déploiement Production](04-integration-and-deployment.md)
* **Pourquoi le lire** : Intégrer Doc2KB Studio dans vos pipelines d'entreprise, vos flux CI/CD ou sur votre cloud souverain.
* **Au programme** :
  * Architecture 100% en mémoire (*Zero Data Leak*) garantissant la conformité RGPD et HIPAA.
  * Déploiement conteneurisé Docker et `docker-compose.yml`.
  * Exemples d'appels API REST en Python, TypeScript et cURL.
  * Utilisation programmatique en tant que SDK / bibliothèque Node.js locale.
  * Automatisation CI/CD avec GitHub Actions.

### [5. 🛡️ Guide de l'Anonymisation des Données & Protection de la Vie Privée](05-data-anonymization-and-privacy.md)
* **Pourquoi le lire** : Neutraliser 100% des fuites de données sensibles (PII, secrets d'API, coordonnées bancaires) avant l'ingestion dans les LLMs ou bases vectorielles.
* **Au programme** :
  * Conformité réglementaire d'entreprise : RGPD (Articles 5, 25, 32), HIPAA Safe Harbor, PCI-DSS v4.0.
  * Pourquoi le caviarçage aveugle (`[REDACTED]`) ruine le RAG et comment la **pseudonymisation cohérente** (`[PERSONNE_1]`) préserve la co-référence sémantique.
  * Moteurs de validation mathématique formelle de checksums : Luhn (CB), ISO 7064 Modulo 97-10 (IBAN), Modulo 97 (NIR Français).
  * Détection chirurgicale des secrets DevOps (clés OpenAI, AWS IAM, GitHub PAT, tokens JWT, clés privées PEM).
  * Cycle de vie de la table locale de réhydratation (*detokenization*) et checklist d'audit DPO / SecOps.

---

## 🎯 À qui s'adresse cette documentation ?
* **Architectes Web & Tech Leads** : Pour concevoir des architectures d'ingestion documentaire robustes et pérennes.
* **Ingénieurs RAG & Data Scientists** : Pour maximiser le score de rappel (*Recall*) et la précision (*Precision*) de leurs modèles vectoriels.
* **Directeurs Financiers & FinOps IA** : Pour maîtriser et diviser les coûts récurrents liés aux tokens d'inférence.
